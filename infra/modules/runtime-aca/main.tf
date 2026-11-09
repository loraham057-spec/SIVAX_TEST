/**
 * Module runtime-aca — Container Apps environment, two services, three jobs.
 *
 * Design points that are decisions rather than defaults:
 *
 *  · The environment is INTERNAL. Nothing is reachable from the internet
 *    directly; Front Door is the only ingress, over Private Link.
 *
 *  · app-ai never scales to zero. A cold start of a Python runtime loading
 *    LangGraph is measured in tens of seconds — unacceptable for a
 *    conversational assistant, and the reason min_replicas is pinned to 1 even
 *    in dev.
 *
 *  · The ETL runs as a JOB with a cron trigger, not as a thread inside the web
 *    service. With APScheduler in-process, every replica fires its own sync at
 *    03:00 and multiplies the load on an SNIS RDC instance that is already the
 *    bottleneck. The web app is deployed with ETL_SCHEDULER_ENABLED=false to
 *    enforce that.
 *
 *  · No secret value appears here. Every `secret{}` block is a Key Vault
 *    reference resolved at runtime by a managed identity, so inspecting a
 *    running container reveals references, not credentials.
 */

resource "azurerm_container_app_environment" "main" {
  name                = var.names.container_app_env
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  infrastructure_subnet_id       = var.runtime_subnet_id
  internal_load_balancer_enabled = true
  zone_redundancy_enabled        = var.zone_redundant

  log_analytics_workspace_id = var.log_analytics_workspace_id
}

locals {
  # Shared by both services and every job.
  common_secrets = {
    "redis-url"                   = var.key_vault_secret_ids["redis-url"]
    "database-url"                = var.key_vault_secret_ids["database-url"]
    "supabase-service-role-key"   = var.key_vault_secret_ids["supabase-service-role-key"]
    "app-settings-encryption-key" = var.key_vault_secret_ids["app-settings-encryption-key"]
  }

  web_secrets = merge(local.common_secrets, {
    "push-internal-token" = var.key_vault_secret_ids["push-internal-token"]
    "resend-api-key"      = var.key_vault_secret_ids["resend-api-key"]
    "elevenlabs-api-key"  = var.key_vault_secret_ids["elevenlabs-api-key"]
    "openai-api-key"      = var.key_vault_secret_ids["openai-api-key"]
    "vapid-private-key"   = var.key_vault_secret_ids["vapid-private-key"]
  })

  ai_secrets = merge(local.common_secrets, {
    "openai-api-key" = var.key_vault_secret_ids["openai-api-key"]
    "dhis2-password" = var.key_vault_secret_ids["dhis2-password"]
  })

  image = {
    web = "${var.acr_login_server}/${var.project}-web:${var.image_tag}"
    ai  = "${var.acr_login_server}/${var.project}-ai:${var.image_tag}"
  }
}

# ─── app-web — Next.js ─────────────────────────────────────

resource "azurerm_container_app" "web" {
  name                         = var.names.app_web
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["web"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["web"]
  }

  dynamic "secret" {
    for_each = local.web_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["web"]
    }
  }

  template {
    min_replicas = var.web_min_replicas
    max_replicas = var.web_max_replicas

    container {
      name   = "web"
      image  = local.image.web
      cpu    = var.web_cpu
      memory = var.web_memory

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "NEXT_PUBLIC_SITE_URL"
        value = "https://${var.public_hostname}"
      }
      env {
        name  = "FASTAPI_URL"
        value = "https://${azurerm_container_app.ai.ingress[0].fqdn}"
      }
      env {
        name  = "NEXT_PUBLIC_SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        value = var.supabase_anon_key
      }
      env {
        name  = "NEXT_PUBLIC_ASSETS_URL"
        value = var.assets_base_url
      }
      env {
        name  = "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
        value = var.vapid_public_key
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = var.app_insights_connection_string
      }

      env {
        name        = "REDIS_URL"
        secret_name = "redis-url"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "SUPABASE_SERVICE_ROLE_KEY"
        secret_name = "supabase-service-role-key"
      }
      env {
        name        = "APP_SETTINGS_ENCRYPTION_KEY"
        secret_name = "app-settings-encryption-key"
      }
      env {
        name        = "PUSH_INTERNAL_TOKEN"
        secret_name = "push-internal-token"
      }
      env {
        name        = "RESEND_API_KEY"
        secret_name = "resend-api-key"
      }
      env {
        name        = "ELEVENLABS_API_KEY"
        secret_name = "elevenlabs-api-key"
      }
      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-api-key"
      }
      env {
        name        = "VAPID_PRIVATE_KEY"
        secret_name = "vapid-private-key"
      }

      # Liveness must not depend on anything external: a database blip should
      # not get the container killed and restarted.
      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/health"
      }

      # Readiness checks the dependencies, so a replica that cannot serve is
      # taken out of rotation instead of returning errors.
      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/ready"
      }

      startup_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/health"
      }
    }

    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = "50"
    }
  }

  ingress {
    external_enabled = true # within the internal environment only
    target_port      = 3000
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# ─── app-ai — FastAPI + LangGraph ──────────────────────────

resource "azurerm_container_app" "ai" {
  name                         = var.names.app_ai
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["ai"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["ai"]
  }

  dynamic "secret" {
    for_each = local.ai_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["ai"]
    }
  }

  template {
    # Never zero: a cold LangGraph start is far too slow for a chat interface.
    min_replicas = 1
    max_replicas = var.ai_max_replicas

    container {
      name   = "ai"
      image  = local.image.ai
      cpu    = var.ai_cpu
      memory = var.ai_memory

      env {
        name  = "FRONTEND_URL"
        value = "https://${var.public_hostname}"
      }
      # The scheduler lives in the job, not here — otherwise every replica syncs.
      env {
        name  = "ETL_SCHEDULER_ENABLED"
        value = "false"
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      env {
        name  = "OPENAI_MODEL_FAST"
        value = var.openai_model_fast
      }
      env {
        name  = "DHIS2_BASE_URL"
        value = var.dhis2_base_url
      }
      env {
        name  = "DHIS2_USERNAME"
        value = var.dhis2_username
      }
      env {
        name  = "DHIS2_ROOT_OU"
        value = var.dhis2_root_ou
      }
      env {
        name  = "NEXT_PUBLIC_SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = var.app_insights_connection_string
      }

      env {
        name        = "REDIS_URL"
        secret_name = "redis-url"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "SUPABASE_SERVICE_ROLE_KEY"
        secret_name = "supabase-service-role-key"
      }
      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-api-key"
      }
      env {
        name        = "DHIS2_PASSWORD"
        secret_name = "dhis2-password"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/api/health"
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/api/ready"
      }
    }

    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = "20"
    }
  }

  ingress {
    external_enabled = false # reachable only from inside the environment
    target_port      = 8000
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# ─── Jobs ──────────────────────────────────────────────────

locals {
  job_secrets = merge(local.ai_secrets, {
    "dhis2-password" = var.key_vault_secret_ids["dhis2-password"]
  })

  job_env = [
    { name = "DHIS2_BASE_URL", value = var.dhis2_base_url },
    { name = "DHIS2_USERNAME", value = var.dhis2_username },
    { name = "DHIS2_ROOT_OU", value = var.dhis2_root_ou },
    { name = "NEXT_PUBLIC_SUPABASE_URL", value = var.supabase_url },
    { name = "APPLICATIONINSIGHTS_CONNECTION_STRING", value = var.app_insights_connection_string },
  ]

  job_secret_env = [
    { name = "REDIS_URL", secret_name = "redis-url" },
    { name = "DATABASE_URL", secret_name = "database-url" },
    { name = "SUPABASE_SERVICE_ROLE_KEY", secret_name = "supabase-service-role-key" },
    { name = "DHIS2_PASSWORD", secret_name = "dhis2-password" },
    { name = "OPENAI_API_KEY", secret_name = "openai-api-key" },
  ]
}

# Mid-week incremental sync (Wednesday 03:00 UTC, low-load window on SNIS RDC).
# Together with the Sunday full sync, data is never more than 3-4 days behind.
resource "azurerm_container_app_job" "etl" {
  name                         = var.names.job_etl
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.main.id
  tags                         = var.tags

  replica_timeout_in_seconds = 7200
  replica_retry_limit        = 2

  schedule_trigger_config {
    cron_expression          = var.etl_cron
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["jobs"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["jobs"]
  }

  dynamic "secret" {
    for_each = local.job_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["jobs"]
    }
  }

  template {
    container {
      name    = "etl"
      image   = local.image.ai
      cpu     = 1.0
      memory  = "2Gi"
      command = ["python", "-m", "app.etl.cli"]
      args    = ["--scope", "incremental"]

      dynamic "env" {
        for_each = local.job_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = local.job_secret_env
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }
}

# Sunday sync of the 3 last complete months, including the zone level of the
# thematic pages. DHIS2 corrects data retroactively for about 90 days; months
# older than that are loaded once with `--scope history`. The resource keeps
# its historical name to avoid a destroy/recreate.
resource "azurerm_container_app_job" "etl_full" {
  name                         = "${var.names.job_etl}-full"
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.main.id
  tags                         = var.tags

  replica_timeout_in_seconds = 7200
  replica_retry_limit        = 1

  schedule_trigger_config {
    cron_expression          = var.etl_full_cron
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["jobs"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["jobs"]
  }

  dynamic "secret" {
    for_each = local.job_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["jobs"]
    }
  }

  template {
    container {
      name    = "etl-full"
      image   = local.image.ai
      cpu     = 1.0
      memory  = "2Gi"
      command = ["python", "-m", "app.etl.cli"]
      args    = ["--scope", "weekly"]

      dynamic "env" {
        for_each = local.job_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = local.job_secret_env
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }
}

# Monthly sync of yearly aggregates and population (Cibles page): they change
# at most a few times a year.
resource "azurerm_container_app_job" "etl_annual" {
  name                         = "${var.names.job_etl}-annual"
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.main.id
  tags                         = var.tags

  replica_timeout_in_seconds = 3600
  replica_retry_limit        = 1

  schedule_trigger_config {
    cron_expression          = var.etl_annual_cron
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["jobs"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["jobs"]
  }

  dynamic "secret" {
    for_each = local.job_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["jobs"]
    }
  }

  template {
    container {
      name    = "etl-annual"
      image   = local.image.ai
      cpu     = 1.0
      memory  = "2Gi"
      command = ["python", "-m", "app.etl.cli"]
      args    = ["--scope", "annual"]

      dynamic "env" {
        for_each = local.job_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = local.job_secret_env
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }
}

# Triggered by the CI before a deployment, never on a schedule.
resource "azurerm_container_app_job" "migrate" {
  name                         = var.names.job_migrate
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.main.id
  tags                         = var.tags

  replica_timeout_in_seconds = 900
  replica_retry_limit        = 0 # a failed migration must be looked at, not retried

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_ids["jobs"]]
  }

  registry {
    server   = var.acr_login_server
    identity = var.identity_ids["jobs"]
  }

  dynamic "secret" {
    for_each = local.job_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = var.identity_ids["jobs"]
    }
  }

  template {
    container {
      name    = "migrate"
      image   = local.image.ai
      cpu     = 0.5
      memory  = "1Gi"
      command = ["python", "-m", "app.db.migrate"]

      dynamic "env" {
        for_each = local.job_secret_env
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }
}

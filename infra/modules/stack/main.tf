/**
 * Module stack — composes the whole platform for one environment.
 *
 * Each environment directory is a thin wrapper around this module with its own
 * state file and its own tfvars. That gives the property the roadmap asks for:
 * the SAME Terraform code across dev, staging and prod, with only sizing and
 * safety switches differing — while keeping one state per environment so a
 * mistake cannot reach beyond the environment it was made in.
 *
 * Creating a fourth environment is a new directory with a tfvars file.
 */

data "azurerm_client_config" "current" {}

# ─── Names and tags ────────────────────────────────────────

module "naming" {
  source = "../naming"

  project             = var.project
  env                 = var.env
  location            = var.location
  subscription_id     = var.subscription_id
  owner               = var.owner
  cost_center         = var.cost_center
  data_classification = var.data_classification
}

resource "azurerm_resource_group" "main" {
  name     = module.naming.resource_group
  location = var.location
  tags     = module.naming.tags
}

# ─── Network ───────────────────────────────────────────────

module "network" {
  source = "../network"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  names               = module.naming.names
  tags                = module.naming.tags
  address_space       = var.address_space
  zone_redundant      = var.zone_redundant

  # On AKS, pre-create the ingress public IP so the Front Door origin is known
  # at plan time — one apply instead of two.
  create_ingress_pip = var.orchestrator == "aks"

  # Sans Front Door, l'IP publique de l'ingress est le seul chemin d'entrée :
  # le NSG doit laisser passer 80/443 depuis Internet, sinon rien n'atteint le
  # cluster.
  frontdoor_enabled = var.enable_frontdoor
}

# ─── Identity ──────────────────────────────────────────────

module "identity" {
  source = "../identity"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = module.naming.tags

  identities = {
    web  = module.naming.names.identity_web
    ai   = module.naming.names.identity_ai
    jobs = module.naming.names.identity_jobs
    cicd = module.naming.names.identity_cicd
  }
}

# ─── Observability (first, so everything else can log into it) ───

module "observability" {
  source = "../observability"

  resource_group_name = azurerm_resource_group.main.name
  resource_group_id   = azurerm_resource_group.main.id
  location            = var.location
  env                 = var.env
  names               = module.naming.names
  tags                = module.naming.tags

  retention_days     = var.log_retention_days
  alert_emails       = var.alert_emails
  monthly_budget_eur = var.monthly_budget_eur

  # Wired after the fact to avoid a cycle: alerts reference resources that are
  # themselves created below.
  # The alerts scope onto the profile, so they only exist when it does —
  # otherwise Terraform builds an alert with an empty scope and fails on
  # "cannot parse scopes.0 as a resource id".
  enable_frontdoor_alerts    = var.enable_frontdoor
  enable_etl_freshness_alert = var.enable_etl_freshness_alert
  frontdoor_profile_id       = var.enable_frontdoor ? module.frontdoor[0].profile_id : ""
  postgres_server_id         = module.postgresql.id
}

# ─── Registry ──────────────────────────────────────────────

module "acr" {
  source = "../acr"

  name                = module.naming.names.acr
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = module.naming.tags
  sku                 = var.acr_sku

  pull_principal_ids = {
    web  = module.identity.principal_ids["web"]
    ai   = module.identity.principal_ids["ai"]
    jobs = module.identity.principal_ids["jobs"]
  }
  push_principal_ids = {
    cicd = module.identity.principal_ids["cicd"]
  }
}

# ─── Storage ───────────────────────────────────────────────

module "storage" {
  source = "../storage"

  name                = module.naming.names.storage
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = module.naming.tags
  replication_type    = var.storage_replication

  contributor_principal_ids = {
    jobs = module.identity.principal_ids["jobs"]
    web  = module.identity.principal_ids["web"]
  }
  reader_principal_ids = {
    ai = module.identity.principal_ids["ai"]
  }
}

# ─── Data ──────────────────────────────────────────────────

module "postgresql" {
  source = "../postgresql"

  name                = module.naming.names.postgres
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = module.naming.tags

  sku_name      = var.postgres_sku
  storage_mb    = var.postgres_storage_mb
  database_name = module.naming.names.database

  administrator_password = module.keyvault.postgres_admin_password

  delegated_subnet_id = module.network.postgres_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["postgres"]

  backup_retention_days = var.postgres_backup_retention_days
  geo_redundant_backup  = var.postgres_geo_redundant
  high_availability     = var.postgres_high_availability

  entra_administrators = {
    (module.naming.names.identity_jobs) = module.identity.principal_ids["jobs"]
  }

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

# Azure Cache for Redis is being retired: the API now refuses new instances
# with "Azure Cache for Redis is retiring, create Azure Managed Redis instead".
# Its replacement, Azure Managed Redis (Redis Enterprise), starts in the
# hundreds of euros a month — an order of magnitude past what the rest of this
# environment is sized for.
#
# So Redis runs INSIDE the cluster by default (infra/k8s/base/redis.yaml): a
# single small pod, no Azure resource, no cost. That is a sound trade for dev
# and for a budget-constrained production: the cache holds only DHIS2 metadata,
# analytics results and rate-limit counters, all of which are reconstructible —
# the application's cache layer already degrades to in-process memory when
# Redis is unreachable.
#
# Set enable_managed_redis = true to provision Azure Managed Redis instead,
# when durability and a managed SLA justify the cost.
module "redis" {
  count  = var.enable_managed_redis ? 1 : 0
  source = "../redis"

  name                = module.naming.names.redis
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = module.naming.tags

  sku_name = var.redis_sku
  capacity = var.redis_capacity

  private_endpoint_subnet_id = module.network.private_endpoint_subnet_id
  private_dns_zone_id        = module.network.private_dns_zone_ids["redis"]

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

locals {
  # Public entry point. With Front Door the edge hostname; without it, the
  # ingress public IP, reached directly over HTTP — acceptable for dev, not a
  # production posture (no WAF, no TLS termination, no rate limiting).
  public_hostname = (
    var.custom_domain != "" ? var.custom_domain
    : var.enable_frontdoor ? module.frontdoor[0].endpoint_hostname
    : module.network.ingress_ip
  )
  public_url = var.enable_frontdoor || var.custom_domain != "" ? "https://${local.public_hostname}" : "http://${local.public_hostname}"
}

locals {
  # In-cluster Redis is reached over the cluster network; no password, because
  # NetworkPolicy already restricts who can open a connection to it.
  redis_connection_string = (
    var.enable_managed_redis
    ? module.redis[0].connection_string
    : "redis://redis.${var.kubernetes_namespace}.svc.cluster.local:6379"
  )
}

# ─── Azure OpenAI ──────────────────────────────────────────

module "openai" {
  count  = var.enable_openai ? 1 : 0
  source = "../openai"

  name                = module.naming.names.openai
  resource_group_name = azurerm_resource_group.main.name
  # May differ from the platform region — not every region offers the service.
  location = var.openai_location
  tags     = module.naming.tags

  deployments = var.openai_deployments

  user_principal_ids = {
    ai   = module.identity.principal_ids["ai"]
    jobs = module.identity.principal_ids["jobs"]
  }

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

# ─── Secrets ───────────────────────────────────────────────

module "keyvault" {
  source = "../keyvault"

  name                = module.naming.names.key_vault
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = module.naming.tags

  private_endpoint_subnet_id = module.network.private_endpoint_subnet_id
  private_dns_zone_id        = module.network.private_dns_zone_ids["keyvault"]

  terraform_principal_id = data.azurerm_client_config.current.object_id

  # Terraform writes the secrets from outside the VNet, so its address must be
  # allowed through the vault firewall.
  public_network_access_enabled = var.key_vault_public_access
  allowed_ip_rules              = var.key_vault_allowed_ips

  reader_principal_ids = {
    web  = module.identity.principal_ids["web"]
    ai   = module.identity.principal_ids["ai"]
    jobs = module.identity.principal_ids["jobs"]
  }

  # Third-party values arrive through TF_VAR_* from GitHub Environment Secrets.
  # The connection strings are composed here so no human ever handles them.
  # Third-party secrets: values known at plan (literal or empty).
  secrets = {
    "openai-api-key"            = var.openai_api_key
    "dhis2-password"            = var.dhis2_password
    "resend-api-key"            = var.resend_api_key
    "elevenlabs-api-key"        = var.elevenlabs_api_key
    "supabase-service-role-key" = var.supabase_service_role_key
    "vapid-private-key"         = var.vapid_private_key
  }
  # Connection strings composed from other resources — unknown at plan.
  computed_secrets = {
    "redis-url"    = local.redis_connection_string
    "database-url" = module.postgresql.connection_string
  }

  soft_delete_retention_days = var.key_vault_retention_days
  purge_protection_enabled   = var.key_vault_purge_protection
  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

# ─── Runtime ───────────────────────────────────────────────

# The two runtime modules are interchangeable: everything around them —
# network, database, cache, Key Vault, registry, Front Door, observability — is
# shared and untouched by the choice. Switching is a variable, not a project.
#
# The AI service is the one workload whose behaviour must not differ between
# them: it never scales to zero on either.

module "runtime" {
  count  = var.orchestrator == "aca" ? 1 : 0
  source = "../runtime-aca"

  project             = var.project
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  names               = module.naming.names
  tags                = module.naming.tags

  runtime_subnet_id          = module.network.runtime_subnet_id
  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
  zone_redundant             = var.zone_redundant

  identity_ids     = module.identity.ids
  acr_login_server = module.acr.login_server
  image_tag        = var.image_tag

  key_vault_secret_ids = module.keyvault.secret_ids

  public_hostname = local.public_hostname


  web_min_replicas = var.web_min_replicas
  web_max_replicas = var.web_max_replicas
  web_cpu          = var.web_cpu
  web_memory       = var.web_memory
  ai_max_replicas  = var.ai_max_replicas
  ai_cpu           = var.ai_cpu
  ai_memory        = var.ai_memory

  openai_model      = var.openai_model
  openai_model_fast = var.openai_model_fast

  dhis2_base_url = var.dhis2_base_url
  dhis2_username = var.dhis2_username
  dhis2_root_ou  = var.dhis2_root_ou

  supabase_url      = var.supabase_url
  supabase_anon_key = var.supabase_anon_key
  vapid_public_key  = var.vapid_public_key

  assets_base_url                = module.storage.assets_base_url
  app_insights_connection_string = module.observability.app_insights_connection_string
}

module "runtime_aks" {
  count  = var.orchestrator == "aks" ? 1 : 0
  source = "../runtime-aks"

  project             = var.project
  env                 = var.env
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  names               = module.naming.names
  tags                = module.naming.tags

  # Not the delegated ACA subnet — but associated with the same NAT Gateway, so
  # the egress address seen by SNIS RDC is identical either way.
  aks_subnet_id = module.network.aks_subnet_id

  kubernetes_version      = var.kubernetes_version
  private_cluster_enabled = var.aks_private_cluster
  sku_tier                = var.aks_sku_tier
  zone_redundant          = var.zone_redundant

  system_node_vm_size        = var.aks_system_node_vm_size
  system_node_count          = var.aks_system_node_count
  system_autoscaling_enabled = var.aks_system_autoscaling_enabled
  system_node_min_count      = var.aks_system_node_min_count
  system_node_max_count      = var.aks_system_node_max_count
  system_pool_dedicated      = var.aks_system_pool_dedicated
  enable_user_pool           = var.aks_enable_user_pool
  enable_container_insights  = var.enable_container_insights
  acme_email                 = var.acme_email
  ingress_host               = var.custom_domain != "" ? var.custom_domain : var.aks_ingress_hostname
  user_autoscaling_enabled   = var.aks_user_autoscaling_enabled
  user_node_count            = var.aks_user_node_count
  user_node_vm_size          = var.aks_user_node_vm_size
  user_node_min_count        = var.aks_user_node_min_count
  user_node_max_count        = var.aks_user_node_max_count

  admin_group_object_ids = var.aks_admin_group_object_ids
  acr_id                 = module.acr.id

  # The principal running this apply is the CI/CD service principal; grant it
  # the roles k8s-deploy needs so `az aks command invoke` is authorised by
  # design rather than by the subscription-wide Contributor grant.
  deployer_principal_id = data.azurerm_client_config.current.object_id

  # Pre-created ingress IP: the cluster identity is granted Network Contributor
  # on it, and its name is substituted into the ingress-nginx Service.
  ingress_pip_id   = module.network.ingress_pip_id
  ingress_pip_name = module.network.ingress_pip_name

  # The values Flux substitutes into the overlays at reconcile time — the whole
  # reason the app deploys after a single apply with no placeholders to fill.
  # All non-secret (GUIDs, names, public URLs).
  app_substitutions = {
    acr_login_server = module.acr.login_server
    web_client_id    = module.identity.client_ids["web"]
    ai_client_id     = module.identity.client_ids["ai"]
    jobs_client_id   = module.identity.client_ids["jobs"]
    key_vault_name   = module.naming.names.key_vault
    # Nom public servi par l'ingress : il porte le host de la règle et le sujet
    # du certificat. C'est `custom_domain` qui fait foi, la même valeur qui rend
    # public_url https:// plutôt que http:// ; aks_ingress_hostname reste le
    # repli pour un edge personnalisé sans domaine déclaré. Vide, l'overlay
    # n'ajoute pas de bloc TLS et l'environnement reste joint par IP.
    ingress_host                  = var.custom_domain != "" ? var.custom_domain : var.aks_ingress_hostname
    tenant_id                     = data.azurerm_client_config.current.tenant_id
    front_door_id                 = var.enable_frontdoor ? module.frontdoor[0].resource_guid : ""
    site_url                      = local.public_url
    supabase_url                  = var.supabase_url
    assets_url                    = module.storage.assets_base_url
    appinsights_connection_string = module.observability.app_insights_connection_string

    # Passthrough, not a real value: it re-emits the nginx runtime variable
    # $http_x_azure_fdid unchanged through Flux's single substitution pass,
    # which would otherwise blank it — and a blank left side makes the Front
    # Door check reject every request.
    http_x_azure_fdid = "$http_x_azure_fdid"
  }

  # Keys MUST match the ServiceAccount names in k8s/base/serviceaccounts.yaml:
  # they form the subject of the federated credential.
  workload_identities = {
    web  = module.identity.ids["web"]
    ai   = module.identity.ids["ai"]
    jobs = module.identity.ids["jobs"]
  }

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id

  gitops_enabled        = var.gitops_enabled
  gitops_use_deploy_key = var.gitops_use_deploy_key
  gitops_https_token    = var.gitops_https_token
  gitops_repository_url = (var.gitops_use_deploy_key && var.gitops_https_token == "") ? replace(replace(var.gitops_repository_url, "https://github.com/", "ssh://git@github.com/"), ".git", ".git") : var.gitops_repository_url
  gitops_branch         = var.gitops_branch
}

locals {
  # Front Door origin, whichever runtime is active. On AKS it is the pre-created
  # ingress public IP (module.network.ingress_ip), known at plan time — so no
  # second apply to feed an IP back. `aks_ingress_hostname` stays as an optional
  # override for a custom edge (a hostname in front of the ingress, say).
  app_origin_host = (
    var.orchestrator == "aca"
    ? module.runtime[0].web_fqdn
    : (var.aks_ingress_hostname != "" ? var.aks_ingress_hostname : module.network.ingress_ip)
  )

  # Private Link to the origin is only expressible for Container Apps: on AKS
  # the Private Link Service is created by the cloud provider from a Service
  # annotation, so its id does not exist when this plan is computed.
  app_private_link_target_id = (
    var.orchestrator == "aca" && var.frontdoor_sku == "Premium_AzureFrontDoor"
    ? module.runtime[0].web_app_id
    : ""
  )
}

# ─── Edge ──────────────────────────────────────────────────

# Front Door needs a profile quota this subscription does not have ("the
# number of profiles created exceeds quota" — it ships at zero and is raised by
# a support request). Made optional so an environment can run without it: the
# ingress public IP is then the entry point, without CDN, WAF or edge caching.
module "frontdoor" {
  count  = var.enable_frontdoor ? 1 : 0
  source = "../frontdoor"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  names               = module.naming.names
  tags                = module.naming.tags

  sku_name                   = var.frontdoor_sku
  app_origin_host            = local.app_origin_host
  app_private_link_target_id = local.app_private_link_target_id
  assets_origin_host         = module.storage.primary_blob_host
  custom_domain              = var.custom_domain
  waf_mode                   = var.waf_mode

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

# ─── Governance ────────────────────────────────────────────

module "governance" {
  source = "../governance"

  resource_group_id = azurerm_resource_group.main.id
  enforce_policies  = var.enforce_policies
  defender_plans    = var.defender_plans

  locked_resource_ids = var.enable_deletion_locks ? {
    postgres = module.postgresql.id
    keyvault = module.keyvault.id
    storage  = module.storage.id
  } : {}
}

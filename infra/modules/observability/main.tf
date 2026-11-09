/**
 * Module observability — logs, traces, alerts and cost budgets.
 *
 * The alerts here are deliberately few and each maps to a decision someone
 * would actually take. Two of them are specific to this platform rather than
 * generic infrastructure hygiene:
 *
 *  · "no successful ETL in 26h" — the warehouse is the only thing standing
 *    between users and a slow, unstable SNIS RDC. A silently failing sync
 *    degrades every dashboard without any error appearing anywhere.
 *
 *  · "data older than 48h" — reads the application's own etl_runs table
 *    through the container logs. Freshness is the metric decision-makers care
 *    about; infrastructure being green while data is three days stale is the
 *    failure mode worth catching.
 */

resource "azurerm_log_analytics_workspace" "main" {
  name                = var.names.log_analytics
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_days
  tags                = var.tags
}

resource "azurerm_application_insights" "main" {
  name                = var.names.app_insights
  resource_group_name = var.resource_group_name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = var.tags
}

# ─── Notification ──────────────────────────────────────────
#
# The webhook targets the platform's own push endpoint, so an infrastructure
# alert reaches decision-makers through the same channel as a health alert.

resource "azurerm_monitor_action_group" "main" {
  name                = var.names.action_group
  resource_group_name = var.resource_group_name
  short_name          = substr(replace(var.names.action_group, "-", ""), 0, 12)
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = var.alert_emails
    content {
      name                    = "email-${email_receiver.key}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }

  dynamic "webhook_receiver" {
    for_each = var.alert_webhook_url == "" ? [] : [var.alert_webhook_url]
    content {
      name                    = "platform-push"
      service_uri             = webhook_receiver.value
      use_common_alert_schema = true
    }
  }
}

# ─── Availability and latency ──────────────────────────────

resource "azurerm_monitor_metric_alert" "frontdoor_5xx" {
  count = var.enable_frontdoor_alerts ? 1 : 0

  name                = "alert-${var.env}-frontdoor-5xx"
  resource_group_name = var.resource_group_name
  scopes              = [var.frontdoor_profile_id]
  description         = "More than 1% of edge responses are 5xx over 5 minutes."
  severity            = 1
  window_size         = "PT5M"
  frequency           = "PT1M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Cdn/profiles"
    metric_name      = "Percentage5XX"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
}

resource "azurerm_monitor_metric_alert" "frontdoor_latency" {
  count = var.enable_frontdoor_alerts ? 1 : 0

  name                = "alert-${var.env}-origin-latency"
  resource_group_name = var.resource_group_name
  scopes              = [var.frontdoor_profile_id]
  description         = "Origin latency above 2s over 10 minutes — the read path budget is 300ms P95."
  severity            = 2
  window_size         = "PT15M"
  frequency           = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Cdn/profiles"
    metric_name      = "OriginLatency"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 2000
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
}

# ─── Database ──────────────────────────────────────────────

resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  count = var.enable_postgres_alerts ? 1 : 0

  name                = "alert-${var.env}-postgres-cpu"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL CPU above 80% for 15 minutes."
  severity            = 2
  window_size         = "PT15M"
  frequency           = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
}

resource "azurerm_monitor_metric_alert" "postgres_storage" {
  count = var.enable_postgres_alerts ? 1 : 0

  name                = "alert-${var.env}-postgres-storage"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL storage above 85%."
  severity            = 1
  window_size         = "PT15M"
  frequency           = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
}

# ─── ETL health and data freshness ─────────────────────────

# ⚠️ Azure validates the KQL at creation, against the tables that ALREADY exist
# in the workspace. `ContainerLogV2` is created by Container Insights only once
# the first container logs arrive, so this alert cannot be created on a fresh
# workspace — it fails with "Failed to resolve table or column expression".
#
# Hence the toggle: enable it on the second apply, after the cluster has run
# for a few minutes. It is not optional in spirit — a silently failing ETL
# degrades every dashboard with no other signal — just in ordering.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "etl_missing" {
  count                = var.enable_etl_freshness_alert ? 1 : 0
  name                 = "alert-${var.env}-etl-no-success"
  resource_group_name  = var.resource_group_name
  location             = var.location
  description          = "No successful ETL run in the last 26 hours (the job is scheduled daily at 03:00 UTC)."
  severity             = 1
  scopes               = [azurerm_log_analytics_workspace.main.id]
  evaluation_frequency = "PT1H"
  window_duration      = "PT6H"
  tags                 = var.tags

  criteria {
    # Counts successful runs in the window. Zero means the sync has not
    # completed since — which is the condition worth waking someone for,
    # because every dashboard silently goes stale behind it.
    query                   = <<-KQL
      ContainerLogV2
      | where TimeGenerated > ago(26h)
      | where ContainerName has "etl"
      | where LogMessage has "ETL sync succeeded"
      | summarize Successes = count()
    KQL
    time_aggregation_method = "Total"
    metric_measure_column   = "Successes"
    threshold               = 1
    operator                = "LessThan"
  }

  action {
    action_groups = [azurerm_monitor_action_group.main.id]
  }
}

# ─── Cost ──────────────────────────────────────────────────
#
# LLM spend is the line item that can run away without anyone noticing, since
# it scales with usage rather than with provisioned capacity — and there is no
# per-user token quota in the application yet (SEC-08).

resource "azurerm_consumption_budget_resource_group" "main" {
  # A budget notification must carry at least one contact — Azure rejects it
  # with "Notification cannot have all of Contact Emails, Contact Roles and
  # Contact Groups empty". A budget nobody is told about is pointless anyway.
  count = var.monthly_budget_eur == 0 || length(var.alert_emails) == 0 ? 0 : 1

  name              = "budget-${var.env}"
  resource_group_id = var.resource_group_id
  amount            = var.monthly_budget_eur
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00'Z'", timestamp())
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 110
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = var.alert_emails
  }

  lifecycle {
    # `timestamp()` changes on every plan; without this the budget would be
    # proposed for replacement on each run.
    ignore_changes = [time_period]
  }
}

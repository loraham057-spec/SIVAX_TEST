/**
 * Module postgresql — Flexible Server on a delegated subnet, no public access.
 *
 * VNet injection rather than a private endpoint: Flexible Server supports
 * either, and injection into a delegated subnet is the mode that makes public
 * access structurally impossible rather than merely disabled.
 *
 * The extensions enabled below are not decoration. `pg_trgm` and `unaccent`
 * are what allow the local DHIS2 metadata index to replace the 16 network
 * round-trips the assistant currently makes per question: French indicator
 * names are searched accent-insensitively with a GIN trigram index.
 */

resource "azurerm_postgresql_flexible_server" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  version    = var.postgres_version
  sku_name   = var.sku_name
  storage_mb = var.storage_mb
  # Autogrow avoids the 3am page for a disk that filled up predictably.
  auto_grow_enabled = true

  administrator_login    = var.administrator_login
  administrator_password = var.administrator_password

  # Entra authentication has to be switched on at the server before an Entra
  # administrator can be attached; without it the assignment fails with
  # "Azure AD authentication is not enabled for the given server".
  # Password auth stays on as the break-glass path.
  authentication {
    active_directory_auth_enabled = length(var.entra_administrators) > 0
    password_auth_enabled         = true
    tenant_id                     = length(var.entra_administrators) > 0 ? var.tenant_id : null
  }

  backup_retention_days        = var.backup_retention_days
  geo_redundant_backup_enabled = var.geo_redundant_backup

  # VNet injection: the server has no public endpoint at all.
  #
  # This must be stated explicitly. The provider defaults it to true, and Azure
  # then rejects the create with ConflictingPublicNetworkAccessAndVirtualNetwork
  # Configuration — public access and VNet injection are mutually exclusive.
  public_network_access_enabled = false

  delegated_subnet_id = var.delegated_subnet_id
  private_dns_zone_id = var.private_dns_zone_id

  zone = var.availability_zone

  dynamic "high_availability" {
    for_each = var.high_availability ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = var.standby_availability_zone
    }
  }

  maintenance_window {
    day_of_week  = 0 # Sunday
    start_hour   = 2
    start_minute = 0
  }

  lifecycle {
    ignore_changes = [
      # Azure rewrites zone assignment on failover; letting Terraform fight it
      # would trigger a needless replacement of the whole server.
      zone,
      high_availability[0].standby_availability_zone,
    ]
  }
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"

  lifecycle {
    prevent_destroy = true
  }
}

# ─── Server configuration ──────────────────────────────────

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "PG_TRGM,UNACCENT,UUID-OSSP,PGCRYPTO"
}

# Log statements slower than a second: the read path budget is 300ms P95, so
# anything above this is a regression worth a name.
resource "azurerm_postgresql_flexible_server_configuration" "slow_queries" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "1000"
}

resource "azurerm_postgresql_flexible_server_configuration" "connection_throttling" {
  name      = "connection_throttle.enable"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "on"
}

# ─── Entra administrator ───────────────────────────────────
#
# Lets operators and jobs authenticate with a managed identity instead of the
# generated password, which then only exists as a break-glass credential.

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "main" {
  for_each = var.entra_administrators

  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  object_id           = each.value
  principal_name      = each.key
  principal_type      = "ServicePrincipal"
}

# ─── Diagnostics ───────────────────────────────────────────

resource "azurerm_monitor_diagnostic_setting" "postgres" {
  count                      = var.enable_diagnostics ? 1 : 0
  name                       = "diag-${var.name}"
  target_resource_id         = azurerm_postgresql_flexible_server.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "PostgreSQLLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

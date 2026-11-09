/**
 * Module storage — static assets, ML artefacts and exports.
 *
 * The `assets` container exists to get the province GeoJSON and the images off
 * the application container. Front Door serves them from here, so the app
 * replicas never spend bandwidth or CPU on bytes that never change; the
 * lifecycle rule below is what makes long cache lifetimes safe.
 *
 * Shared-key access is disabled: every caller authenticates with a managed
 * identity, which means there is no account key to leak in the first place.
 */

resource "azurerm_storage_account" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  account_tier             = "Standard"
  account_replication_type = var.replication_type
  account_kind             = "StorageV2"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  public_network_access_enabled   = var.public_network_access_enabled

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  # Declared only when it actually restricts something.
  #
  # With default_action = "Allow" the rule set constrains nothing, and Azure
  # does not persist it — so Terraform reads it back as absent and proposes to
  # add it again on every plan. That perpetual diff would make the daily drift
  # job open an issue for a no-op, which is how drift detection stops being
  # believed.
  dynamic "network_rules" {
    for_each = var.public_network_access_enabled ? [] : [1]
    content {
      # `AzureServices` is what lets Front Door reach the assets container.
      bypass         = ["AzureServices"]
      default_action = "Deny"
    }
  }
}

resource "azurerm_storage_container" "main" {
  for_each              = toset(var.containers)
  name                  = each.value
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

# ─── Lifecycle ─────────────────────────────────────────────
#
# Exports and ML artefacts accumulate indefinitely otherwise. Assets are
# excluded: they are small, immutable and served on the hot path.

resource "azurerm_storage_management_policy" "main" {
  storage_account_id = azurerm_storage_account.main.id

  rule {
    name    = "tier-and-expire-artifacts"
    enabled = true

    filters {
      prefix_match = ["exports/", "ml-artifacts/"]
      blob_types   = ["blockBlob"]
    }

    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than    = 30
        tier_to_archive_after_days_since_modification_greater_than = 90
        delete_after_days_since_modification_greater_than          = var.artifact_retention_days
      }

      version {
        delete_after_days_since_creation = 30
      }
    }
  }
}

# ─── Access ────────────────────────────────────────────────

resource "azurerm_role_assignment" "contributors" {
  for_each             = var.contributor_principal_ids
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "readers" {
  for_each             = var.reader_principal_ids
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = each.value
}

resource "azurerm_private_endpoint" "blob" {
  count               = var.public_network_access_enabled ? 0 : 1
  name                = "pe-${var.name}-blob"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}-blob"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

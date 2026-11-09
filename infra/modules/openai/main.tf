/**
 * Module openai — Azure OpenAI account and model deployments.
 *
 * Two deployments, matching the cost routing the agent implements: a small
 * model for intent classification, clarification and fact-check regeneration
 * (nodes whose output the user never reads), and a capable one for the single
 * node that writes the answer.
 *
 * ⚠️ Terraform creates the deployments but CANNOT raise their token-per-minute
 * quota — that is granted by a Microsoft support request. Provision the quota
 * before the first production load test, not after.
 *
 * Azure OpenAI is not available in every region. When the platform region does
 * not offer it, set `location` here to a region that does; everything else
 * stays where it is.
 */

resource "azurerm_cognitive_account" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  kind     = "OpenAI"
  sku_name = "S0"

  # A custom subdomain is required for both private endpoints and Entra auth.
  custom_subdomain_name         = var.name
  public_network_access_enabled = var.public_network_access_enabled
  local_auth_enabled            = var.local_auth_enabled

  identity {
    type = "SystemAssigned"
  }

  network_acls {
    default_action = var.public_network_access_enabled ? "Allow" : "Deny"
  }
}

resource "azurerm_cognitive_deployment" "main" {
  for_each             = var.deployments
  name                 = each.key
  cognitive_account_id = azurerm_cognitive_account.main.id

  model {
    format  = "OpenAI"
    name    = each.value.model
    version = each.value.version
  }

  sku {
    name     = each.value.sku
    capacity = each.value.capacity
  }
}

# ─── Access ────────────────────────────────────────────────
#
# Workloads call the API with their managed identity rather than an API key,
# so there is no OpenAI key to store for the Azure-hosted path.

resource "azurerm_role_assignment" "users" {
  for_each             = var.user_principal_ids
  scope                = azurerm_cognitive_account.main.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = each.value
}

resource "azurerm_private_endpoint" "openai" {
  count               = var.public_network_access_enabled ? 0 : 1
  name                = "pe-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}"
    private_connection_resource_id = azurerm_cognitive_account.main.id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

resource "azurerm_monitor_diagnostic_setting" "openai" {
  count                      = var.enable_diagnostics ? 1 : 0
  name                       = "diag-${var.name}"
  target_resource_id         = azurerm_cognitive_account.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "Audit"
  }

  enabled_log {
    category = "RequestResponse"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

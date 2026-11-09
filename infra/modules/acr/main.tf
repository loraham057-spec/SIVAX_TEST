/**
 * Module acr — container registry.
 *
 * Admin user stays disabled: pulls are authorised by AcrPull role assignments
 * on the workload identities, so there is no registry password anywhere. The
 * CI pushes with the same OIDC federation it uses for Terraform.
 *
 * Premium is required for private endpoints and for the retention policy on
 * untagged manifests; Basic is fine in dev, where the registry is reachable
 * publicly and images are disposable.
 */

resource "azurerm_container_registry" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  sku                           = var.sku
  admin_enabled                 = false
  public_network_access_enabled = var.sku == "Premium" ? var.public_network_access_enabled : true

  # Premium only: purge untagged manifests after 30 days. Superseded images
  # accumulate on every build otherwise.
  retention_policy_in_days = var.sku == "Premium" ? 30 : null
}

resource "azurerm_role_assignment" "pull" {
  for_each             = var.pull_principal_ids
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "push" {
  for_each             = var.push_principal_ids
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPush"
  principal_id         = each.value
}

resource "azurerm_private_endpoint" "acr" {
  count               = var.sku == "Premium" && !var.public_network_access_enabled ? 1 : 0
  name                = "pe-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}"
    private_connection_resource_id = azurerm_container_registry.main.id
    subresource_names              = ["registry"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

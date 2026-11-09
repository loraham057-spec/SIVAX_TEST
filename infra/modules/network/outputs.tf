output "vnet_id" {
  description = "Virtual network id."
  value       = azurerm_virtual_network.main.id
}

output "vnet_name" {
  description = "Virtual network name."
  value       = azurerm_virtual_network.main.name
}

output "runtime_subnet_id" {
  description = "Subnet hosting the Container Apps environment (delegated)."
  value       = azurerm_subnet.runtime.id
}

output "aks_subnet_id" {
  description = "Subnet hosting the AKS node pools (not delegated)."
  value       = azurerm_subnet.aks.id
}

output "private_endpoint_subnet_id" {
  description = "Subnet hosting every private endpoint."
  value       = azurerm_subnet.private_endpoints.id
}

output "postgres_subnet_id" {
  description = "Subnet delegated to PostgreSQL Flexible Server."
  value       = azurerm_subnet.postgres.id
}

output "egress_ip" {
  description = "Stable public egress IP — this is the address to hand to the ministry for a SNIS RDC allow-list entry."
  value       = azurerm_public_ip.nat.ip_address
}

output "ingress_ip" {
  description = "Static public IP for the AKS ingress — the Front Door origin on AKS. Null on Container Apps."
  value       = one(azurerm_public_ip.ingress[*].ip_address)
}

output "ingress_pip_id" {
  description = "Resource id of the AKS ingress public IP (for the Network Contributor grant). Null on Container Apps."
  value       = one(azurerm_public_ip.ingress[*].id)
}

output "ingress_pip_name" {
  description = "Name of the AKS ingress public IP, adopted by the ingress Service annotation."
  value       = one(azurerm_public_ip.ingress[*].name)
}

output "private_dns_zone_ids" {
  description = "Private DNS zone ids keyed by service (postgres, redis, keyvault, blob, acr, openai)."
  value       = { for k, z in azurerm_private_dns_zone.main : k => z.id }
}

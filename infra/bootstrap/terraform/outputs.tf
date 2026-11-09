output "resource_group_name" {
  description = "Value for backend.hcl."
  value       = azurerm_resource_group.tfstate.name
}

output "storage_account_name" {
  description = "Value for backend.hcl."
  value       = azurerm_storage_account.tfstate.name
}

output "container_name" {
  description = "Value for backend.hcl."
  value       = azurerm_storage_container.tfstate.name
}

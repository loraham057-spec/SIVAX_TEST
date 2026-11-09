output "id" {
  description = "Registry resource id."
  value       = azurerm_container_registry.main.id
}

output "login_server" {
  description = "Registry host, used as the image prefix."
  value       = azurerm_container_registry.main.login_server
}

output "name" {
  description = "Registry name."
  value       = azurerm_container_registry.main.name
}

output "id" {
  description = "Server resource id."
  value       = azurerm_postgresql_flexible_server.main.id
}

output "fqdn" {
  description = "Private FQDN — resolvable only from inside the VNet."
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "database_name" {
  description = "Application database name."
  value       = azurerm_postgresql_flexible_server_database.main.name
}

output "connection_string" {
  description = "libpq connection string, TLS enforced."
  value = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=require",
    var.administrator_login,
    urlencode(var.administrator_password),
    azurerm_postgresql_flexible_server.main.fqdn,
    azurerm_postgresql_flexible_server_database.main.name,
  )
  sensitive = true
}

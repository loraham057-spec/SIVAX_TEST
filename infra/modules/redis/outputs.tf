output "id" {
  description = "Cache resource id."
  value       = azurerm_redis_cache.main.id
}

output "hostname" {
  description = "Private hostname."
  value       = azurerm_redis_cache.main.hostname
}

output "connection_string" {
  description = "rediss:// URL — the value of REDIS_URL consumed by both backends."
  value = format(
    "rediss://:%s@%s:%d",
    azurerm_redis_cache.main.primary_access_key,
    azurerm_redis_cache.main.hostname,
    azurerm_redis_cache.main.ssl_port,
  )
  sensitive = true
}

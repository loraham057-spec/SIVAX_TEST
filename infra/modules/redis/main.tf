/**
 * Module redis — the shared state the application currently keeps in process memory.
 *
 * Three things move here, and none of them work correctly at two replicas today:
 *   · the DHIS2 metadata (24h) and analytics (10min) caches
 *   · the agent rate limiter, whose per-process window multiplies the effective
 *     quota by the number of replicas
 *   · the server-side analysis handoff that lets the client reuse the agent's
 *     DHIS2 result instead of replaying it
 *
 * The application already reads REDIS_URL and falls back to memory when unset,
 * so provisioning this changes behaviour without requiring a code change.
 */

resource "azurerm_redis_cache" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  capacity = var.capacity
  family   = var.family
  sku_name = var.sku_name

  minimum_tls_version           = "1.2"
  non_ssl_port_enabled          = false
  public_network_access_enabled = false

  redis_configuration {
    # Cache entries carry their own TTL; evicting the least recently used key
    # under pressure is correct here — losing one is a cache miss, not an error.
    maxmemory_policy = "allkeys-lru"
  }
}

resource "azurerm_private_endpoint" "redis" {
  name                = "pe-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}"
    private_connection_resource_id = azurerm_redis_cache.main.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

resource "azurerm_monitor_diagnostic_setting" "redis" {
  count                      = var.enable_diagnostics ? 1 : 0
  name                       = "diag-${var.name}"
  target_resource_id         = azurerm_redis_cache.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_metric {
    category = "AllMetrics"
  }
}

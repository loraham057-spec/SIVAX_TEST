/**
 * Module frontdoor — the single public entry point.
 *
 * Two origin groups behind one hostname:
 *   · the application, reached over Private Link to the internal Container
 *     Apps environment — the runtime has no public address at all;
 *   · Blob Storage for /geo/* and /images/*, so 200 Ko of province boundaries
 *     and the logo never transit through an application replica.
 *
 * The rate-limiting rule on /api/assistant is not optional hardening. Those
 * endpoints trigger billed LLM and speech-to-text calls and currently accept
 * unauthenticated callers (SEC-03); until that is fixed this rule is the only
 * thing standing between a scraper and the OpenAI invoice. It stays afterwards
 * as defence in depth.
 *
 * Managed OWASP rulesets require the Premium SKU. On Standard the module still
 * applies the custom rate-limit rule.
 */

locals {
  is_premium = var.sku_name == "Premium_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_profile" "main" {
  name                     = var.names.frontdoor
  resource_group_name      = var.resource_group_name
  sku_name                 = var.sku_name
  response_timeout_seconds = 120 # SNIS RDC fallbacks are slow; do not cut them short
  tags                     = var.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "main" {
  name                     = var.names.frontdoor_ep
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  tags                     = var.tags
}

# ─── Application origin ────────────────────────────────────

resource "azurerm_cdn_frontdoor_origin_group" "app" {
  name                     = "og-app"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                        = 4
    successful_samples_required        = 3
    additional_latency_in_milliseconds = 50
  }

  health_probe {
    path                = "/api/health"
    request_type        = "HEAD"
    protocol            = "Https"
    interval_in_seconds = 60
  }
}

resource "azurerm_cdn_frontdoor_origin" "app" {
  name                          = "origin-app"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app.id
  enabled                       = true

  host_name          = var.app_origin_host
  origin_host_header = var.app_origin_host
  http_port          = 80
  https_port         = 443
  priority           = 1
  weight             = 1000

  certificate_name_check_enabled = true

  # Private Link requires Premium; on Standard the origin is reached over its
  # (still non-routable from the internet) environment hostname.
  dynamic "private_link" {
    for_each = local.is_premium && var.app_private_link_target_id != "" ? [1] : []
    content {
      request_message        = "Front Door to Container Apps"
      location               = var.location
      private_link_target_id = var.app_private_link_target_id
    }
  }
}

# ─── Static assets origin ──────────────────────────────────

resource "azurerm_cdn_frontdoor_origin_group" "assets" {
  count                    = var.enable_assets_origin ? 1 : 0
  name                     = "og-assets"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
}

resource "azurerm_cdn_frontdoor_origin" "assets" {
  count                         = var.enable_assets_origin ? 1 : 0
  name                          = "origin-assets"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.assets[0].id
  enabled                       = true

  host_name                      = var.assets_origin_host
  origin_host_header             = var.assets_origin_host
  https_port                     = 443
  http_port                      = 80
  priority                       = 1
  weight                         = 1000
  certificate_name_check_enabled = true
}

# ─── Caching rules ─────────────────────────────────────────
#
# The application already emits Cache-Control with stale-while-revalidate on
# its read endpoints; Front Door honours those. This rule set only pins the
# immutable assets, whose lifetime does not depend on the application.

resource "azurerm_cdn_frontdoor_rule_set" "assets" {
  count                    = var.enable_assets_origin ? 1 : 0
  name                     = "assetscaching"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
}

resource "azurerm_cdn_frontdoor_rule" "immutable_assets" {
  count                     = var.enable_assets_origin ? 1 : 0
  name                      = "immutableassets"
  cdn_frontdoor_rule_set_id = azurerm_cdn_frontdoor_rule_set.assets[0].id
  order                     = 1
  behavior_on_match         = "Continue"

  conditions {
    url_path_condition {
      operator     = "BeginsWith"
      match_values = ["/geo/", "/images/"]
    }
  }

  actions {
    route_configuration_override_action {
      cache_behavior                = "OverrideAlways"
      cache_duration                = "365.00:00:00"
      query_string_caching_behavior = "IgnoreQueryString"
      compression_enabled           = true
    }

    response_header_action {
      header_action = "Overwrite"
      header_name   = "Cache-Control"
      value         = "public, max-age=31536000, immutable"
    }
  }
}

# ─── Routes ────────────────────────────────────────────────

resource "azurerm_cdn_frontdoor_route" "assets" {
  count                         = var.enable_assets_origin ? 1 : 0
  name                          = "route-assets"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.assets[0].id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.assets[0].id]
  cdn_frontdoor_rule_set_ids    = [azurerm_cdn_frontdoor_rule_set.assets[0].id]

  enabled                = true
  forwarding_protocol    = "HttpsOnly"
  https_redirect_enabled = true
  patterns_to_match      = ["/geo/*", "/images/*"]
  supported_protocols    = ["Http", "Https"]

  cdn_frontdoor_custom_domain_ids = var.custom_domain == "" ? [] : [azurerm_cdn_frontdoor_custom_domain.main[0].id]
  link_to_default_domain          = true

  cache {
    compression_enabled = true
    # Front Door only compresses from a fixed list of content types; GeoJSON is
    # served as application/json, which is on it.
    content_types_to_compress = [
      "application/json",
      "image/svg+xml",
    ]
  }
}

resource "azurerm_cdn_frontdoor_route" "app" {
  name                          = "route-app"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.app.id]

  enabled                = true
  forwarding_protocol    = "HttpsOnly"
  https_redirect_enabled = true
  patterns_to_match      = ["/*"]
  supported_protocols    = ["Http", "Https"]

  cdn_frontdoor_custom_domain_ids = var.custom_domain == "" ? [] : [azurerm_cdn_frontdoor_custom_domain.main[0].id]
  link_to_default_domain          = true

  # Compress the origin→edge JSON that FastAPI and Next.js now gzip anyway;
  # this covers the response types they do not.
  cache {
    compression_enabled = true
    content_types_to_compress = [
      "application/javascript",
      "application/json",
      "text/css",
      "text/html",
      "text/plain",
      "image/svg+xml",
    ]
    query_string_caching_behavior = "UseQueryString"
  }
}

# ─── Custom domain ─────────────────────────────────────────

resource "azurerm_cdn_frontdoor_custom_domain" "main" {
  count                    = var.custom_domain == "" ? 0 : 1
  name                     = replace(var.custom_domain, ".", "-")
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  host_name                = var.custom_domain

  tls {
    certificate_type = "ManagedCertificate"
    minimum_version  = "TLS12"
  }
}

resource "azurerm_cdn_frontdoor_custom_domain_association" "main" {
  count                          = var.custom_domain == "" ? 0 : 1
  cdn_frontdoor_custom_domain_id = azurerm_cdn_frontdoor_custom_domain.main[0].id
  cdn_frontdoor_route_ids = concat(
    [azurerm_cdn_frontdoor_route.app.id],
    var.assets_origin_host == "" ? [] : [azurerm_cdn_frontdoor_route.assets[0].id],
  )
}

# ─── WAF ───────────────────────────────────────────────────

resource "azurerm_cdn_frontdoor_firewall_policy" "main" {
  name                = var.names.waf_policy
  resource_group_name = var.resource_group_name
  sku_name            = azurerm_cdn_frontdoor_profile.main.sku_name
  enabled             = true
  mode                = var.waf_mode
  tags                = var.tags

  # Billed LLM and speech-to-text endpoints. 30 requests per minute per IP is
  # well above any legitimate conversational pace.
  custom_rule {
    name                           = "RateLimitAssistant"
    enabled                        = true
    priority                       = 100
    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = var.assistant_rate_limit
    type                           = "RateLimitRule"
    action                         = "Block"

    match_condition {
      match_variable     = "RequestUri"
      operator           = "Contains"
      negation_condition = false
      match_values       = ["/api/assistant"]
    }
  }

  # Broad protection against scripted traffic on the rest of the API.
  custom_rule {
    name                           = "RateLimitApi"
    enabled                        = true
    priority                       = 200
    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = var.api_rate_limit
    type                           = "RateLimitRule"
    action                         = "Block"

    match_condition {
      match_variable     = "RequestUri"
      operator           = "Contains"
      negation_condition = false
      match_values       = ["/api/"]
    }
  }

  dynamic "managed_rule" {
    for_each = local.is_premium ? [1] : []
    content {
      type    = "Microsoft_DefaultRuleSet"
      version = "2.1"
      action  = "Block"
    }
  }

  dynamic "managed_rule" {
    for_each = local.is_premium ? [1] : []
    content {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.0"
      action  = "Log"
    }
  }
}

resource "azurerm_cdn_frontdoor_security_policy" "main" {
  name                     = "sp-${var.names.frontdoor}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.main.id

      association {
        patterns_to_match = ["/*"]

        dynamic "domain" {
          for_each = var.custom_domain == "" ? [azurerm_cdn_frontdoor_endpoint.main.id] : [azurerm_cdn_frontdoor_custom_domain.main[0].id]
          content {
            cdn_frontdoor_domain_id = domain.value
          }
        }
      }
    }
  }
}

resource "azurerm_monitor_diagnostic_setting" "frontdoor" {
  count                      = var.enable_diagnostics ? 1 : 0
  name                       = "diag-${var.names.frontdoor}"
  target_resource_id         = azurerm_cdn_frontdoor_profile.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "FrontDoorAccessLog"
  }

  enabled_log {
    category = "FrontDoorWebApplicationFirewallLog"
  }
}

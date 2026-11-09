output "profile_id" {
  description = "Front Door profile id — scope of the edge alerts."
  value       = azurerm_cdn_frontdoor_profile.main.id
}

output "resource_guid" {
  description = "Front Door ID (the X-Azure-FDID value the origin checks to prove a request came from this profile, not another tenant's Front Door)."
  value       = azurerm_cdn_frontdoor_profile.main.resource_guid
}

output "endpoint_hostname" {
  description = "Default *.azurefd.net hostname."
  value       = azurerm_cdn_frontdoor_endpoint.main.host_name
}

output "public_url" {
  description = "Public URL of the platform."
  value       = var.custom_domain == "" ? "https://${azurerm_cdn_frontdoor_endpoint.main.host_name}" : "https://${var.custom_domain}"
}

output "dns_validation" {
  description = "DNS records to create at the registrar when a custom domain is used: a CNAME to the endpoint and the TXT token Front Door validates ownership with."
  value = var.custom_domain == "" ? null : {
    cname_target         = azurerm_cdn_frontdoor_endpoint.main.host_name
    txt_record_name      = "_dnsauth.${var.custom_domain}"
    txt_validation_token = azurerm_cdn_frontdoor_custom_domain.main[0].validation_token
  }
}

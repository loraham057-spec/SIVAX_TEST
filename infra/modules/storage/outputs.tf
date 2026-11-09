output "id" {
  description = "Storage account resource id."
  value       = azurerm_storage_account.main.id
}

output "name" {
  description = "Storage account name."
  value       = azurerm_storage_account.main.name
}

output "primary_blob_host" {
  description = "Blob endpoint host — the Front Door origin for static assets."
  value       = replace(replace(azurerm_storage_account.main.primary_blob_endpoint, "https://", ""), "/", "")
}

output "assets_base_url" {
  description = "Public base URL of the assets container, for NEXT_PUBLIC_ASSETS_URL."
  value       = "${azurerm_storage_account.main.primary_blob_endpoint}assets"
}

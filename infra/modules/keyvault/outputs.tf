output "id" {
  description = "Key Vault resource id."
  value       = azurerm_key_vault.main.id
}

output "uri" {
  description = "Key Vault URI."
  value       = azurerm_key_vault.main.vault_uri
}

output "secret_ids" {
  description = "Versionless secret ids, keyed by secret name. These are what a Container App `secret{}` block references — versionless so a rotation does not require a redeploy."
  value       = { for k, s in azurerm_key_vault_secret.main : k => s.versionless_id }
}

output "postgres_admin_password" {
  description = "Generated PostgreSQL administrator password."
  value       = random_password.postgres_admin.result
  sensitive   = true
}

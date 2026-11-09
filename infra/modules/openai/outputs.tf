output "id" {
  description = "Cognitive account resource id — scope of the LLM cost budget."
  value       = azurerm_cognitive_account.main.id
}

output "endpoint" {
  description = "API endpoint."
  value       = azurerm_cognitive_account.main.endpoint
}

output "primary_key" {
  description = "API key. Only needed while local_auth_enabled is true; prefer managed identity."
  value       = azurerm_cognitive_account.main.primary_access_key
  sensitive   = true
}

output "deployment_names" {
  description = "Deployment names, to pass as OPENAI_MODEL / OPENAI_MODEL_FAST."
  value       = { for k, d in azurerm_cognitive_deployment.main : k => d.name }
}

output "ids" {
  description = "Identity resource ids, keyed by logical role."
  value       = { for k, i in azurerm_user_assigned_identity.main : k => i.id }
}

output "principal_ids" {
  description = "Object ids — the value to pass to role assignments."
  value       = { for k, i in azurerm_user_assigned_identity.main : k => i.principal_id }
}

output "client_ids" {
  description = "Client ids — needed by workload identity and by Key Vault references."
  value       = { for k, i in azurerm_user_assigned_identity.main : k => i.client_id }
}

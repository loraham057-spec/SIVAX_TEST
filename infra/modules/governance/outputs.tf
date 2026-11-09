output "policy_assignment_ids" {
  description = "Assigned policy ids, for audit."
  value = concat(
    [for a in azurerm_resource_group_policy_assignment.storage_private : a.id],
    [for a in azurerm_resource_group_policy_assignment.postgres_private : a.id],
    [for a in azurerm_resource_group_policy_assignment.required_tags : a.id],
  )
}

output "locked_resources" {
  description = "Resources carrying a deletion lock."
  value       = [for l in azurerm_management_lock.protected : l.scope]
}

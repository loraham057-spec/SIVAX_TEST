output "log_analytics_workspace_id" {
  description = "Workspace resource id."
  value       = azurerm_log_analytics_workspace.main.id
}

output "log_analytics_customer_id" {
  description = "Workspace GUID — what the Container Apps environment expects."
  value       = azurerm_log_analytics_workspace.main.workspace_id
}

output "log_analytics_primary_key" {
  description = "Workspace shared key, consumed by the Container Apps environment."
  value       = azurerm_log_analytics_workspace.main.primary_shared_key
  sensitive   = true
}

output "app_insights_connection_string" {
  description = "Application Insights connection string for OpenTelemetry instrumentation."
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "app_insights_instrumentation_key" {
  description = "Instrumentation key."
  value       = azurerm_application_insights.main.instrumentation_key
  sensitive   = true
}

output "action_group_id" {
  description = "Action group receiving every alert."
  value       = azurerm_monitor_action_group.main.id
}

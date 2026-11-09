output "environment_id" {
  description = "Container Apps environment id."
  value       = azurerm_container_app_environment.main.id
}

output "environment_static_ip" {
  description = "Internal load balancer address of the environment."
  value       = azurerm_container_app_environment.main.static_ip_address
}

output "web_fqdn" {
  description = "Internal FQDN of the web app — the Front Door origin."
  value       = azurerm_container_app.web.ingress[0].fqdn
}

output "ai_fqdn" {
  description = "Internal FQDN of the AI service. Never exposed publicly."
  value       = azurerm_container_app.ai.ingress[0].fqdn
}

output "web_app_id" {
  description = "Web container app id — the Private Link target for Front Door."
  value       = azurerm_container_app.web.id
}

output "migrate_job_name" {
  description = "Manual job name, triggered by the CI before a deployment."
  value       = azurerm_container_app_job.migrate.name
}

output "public_url" {
  description = "Public URL of the platform."
  value       = local.public_url
}

output "egress_ip" {
  description = "Fixed outbound IP — hand this to the ministry for a SNIS RDC allow-list entry. Identical on both orchestrators."
  value       = module.network.egress_ip
}

output "acr_login_server" {
  description = "Registry host, needed by the build workflow."
  value       = module.acr.login_server
}

output "resource_group" {
  description = "Resource group name."
  value       = azurerm_resource_group.main.name
}

output "key_vault_uri" {
  description = "Key Vault URI."
  value       = module.keyvault.uri
}

output "key_vault_name" {
  description = "Key Vault name — required by the SecretProviderClass on AKS."
  value       = module.naming.names.key_vault
}

output "postgres_fqdn" {
  description = "Private database hostname."
  value       = module.postgresql.fqdn
}

output "openai_endpoint" {
  description = "Azure OpenAI endpoint. Empty when Azure OpenAI is disabled (the app uses the external OpenAI API)."
  value       = var.enable_openai ? module.openai[0].endpoint : ""
}

output "assets_base_url" {
  description = "Base URL of the static assets container."
  value       = module.storage.assets_base_url
}

output "dns_validation" {
  description = "DNS records to create at the registrar when a custom domain is configured."
  value       = var.enable_frontdoor ? module.frontdoor[0].dns_validation : null
}

output "orchestrator" {
  description = "Active runtime: aca or aks."
  value       = var.orchestrator
}

# ─── Container Apps outputs (null on AKS) ──────────────────

output "migrate_job_name" {
  description = "Migration job triggered by the CI before a deployment. Container Apps only."
  value       = var.orchestrator == "aca" ? module.runtime[0].migrate_job_name : null
}

# ─── AKS outputs (null on Container Apps) ──────────────────

output "aks_cluster_name" {
  description = "Cluster name, for `az aks command invoke`."
  value       = var.orchestrator == "aks" ? module.runtime_aks[0].cluster_name : null
}

output "aks_node_resource_group" {
  description = "Platform-managed resource group holding nodes and load balancers."
  value       = var.orchestrator == "aks" ? module.runtime_aks[0].node_resource_group : null
}

output "aks_oidc_issuer_url" {
  description = "OIDC issuer backing workload identity."
  value       = var.orchestrator == "aks" ? module.runtime_aks[0].oidc_issuer_url : null
}

output "workload_identity_client_ids" {
  description = <<-DESC
    Client ids to write into the ServiceAccount annotations of
    k8s/overlays/<env>/patch-identity.yaml. These are GUIDs, not secrets.
  DESC
  value       = module.identity.client_ids
}

output "tenant_id" {
  description = "Entra tenant id — required by the SecretProviderClass."
  value       = data.azurerm_client_config.current.tenant_id
}

output "gitops_deploy_public_key" {
  description = "Public half of the Flux deploy key — add it to the repository under Settings → Deploy keys, read-only. Not a secret."
  value       = var.orchestrator == "aks" ? module.runtime_aks[0].gitops_deploy_public_key : null
}

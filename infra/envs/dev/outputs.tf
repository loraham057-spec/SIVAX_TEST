output "public_url" {
  description = "Public URL of the environment."
  value       = module.stack.public_url
}

output "egress_ip" {
  description = "Fixed outbound IP for the SNIS RDC allow-list."
  value       = module.stack.egress_ip
}

output "acr_login_server" {
  description = "Registry host, consumed by the build workflow."
  value       = module.stack.acr_login_server
}

output "resource_group" {
  description = "Resource group name."
  value       = module.stack.resource_group
}

output "assets_base_url" {
  description = "Static assets base URL."
  value       = module.stack.assets_base_url
}

output "dns_validation" {
  description = "Registrar records required by the custom domain, when one is set."
  value       = module.stack.dns_validation
}

output "orchestrator" {
  description = "Active runtime: aca or aks."
  value       = module.stack.orchestrator
}

# ─── Container Apps ────────────────────────────────────────

output "migrate_job_name" {
  description = "Migration job triggered before a deployment. Null on AKS."
  value       = module.stack.migrate_job_name
}

# ─── AKS ───────────────────────────────────────────────────

output "aks_cluster_name" {
  description = "Cluster name, for `az aks command invoke`. Null on Container Apps."
  value       = module.stack.aks_cluster_name
}

output "aks_node_resource_group" {
  description = "Platform-managed resource group holding nodes and load balancers."
  value       = module.stack.aks_node_resource_group
}

# ─── Values needed by the Kubernetes overlays ──────────────
#
# All GUIDs and names, not secrets. Copy them into
# k8s/overlays/<env>/patch-identity.yaml and patch-config.yaml.

output "workload_identity_client_ids" {
  description = "Client ids for the ServiceAccount annotations."
  value       = module.stack.workload_identity_client_ids
}

output "key_vault_name" {
  description = "Key Vault name for the SecretProviderClass."
  value       = module.stack.key_vault_name
}

output "tenant_id" {
  description = "Entra tenant id for the SecretProviderClass."
  value       = module.stack.tenant_id
}

output "gitops_deploy_public_key" {
  description = "Clé publique à déclarer comme deploy key en lecture seule sur le dépôt."
  value       = module.stack.gitops_deploy_public_key
}

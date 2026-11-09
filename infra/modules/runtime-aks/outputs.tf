output "cluster_id" {
  description = "Cluster resource id."
  value       = azurerm_kubernetes_cluster.main.id
}

output "cluster_name" {
  description = "Cluster name — needed by `az aks command invoke` in the CI."
  value       = azurerm_kubernetes_cluster.main.name
}

output "oidc_issuer_url" {
  description = "OIDC issuer backing workload identity federation."
  value       = azurerm_kubernetes_cluster.main.oidc_issuer_url
}

output "node_resource_group" {
  description = "Platform-managed resource group holding the nodes, load balancers and disks."
  value       = azurerm_kubernetes_cluster.main.node_resource_group
}

output "kubelet_identity_object_id" {
  description = "Kubelet identity — the principal that pulls images."
  value       = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}

output "namespace" {
  description = "Namespace hosting the application workloads."
  value       = var.kubernetes_namespace
}

output "gitops_deploy_public_key" {
  description = "Public half of the Flux deploy key. Add it to the repository under Settings → Deploy keys, READ-ONLY. Not a secret."
  value       = var.gitops_use_deploy_key ? tls_private_key.gitops[0].public_key_openssh : null
}

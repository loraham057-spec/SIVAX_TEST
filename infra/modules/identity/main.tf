/**
 * Module identity — one user-assigned managed identity per workload.
 *
 * Separate identities rather than one shared principal: the ETL job needs to
 * write to the warehouse and read DHIS2 credentials, the web app needs neither.
 * Splitting them means a compromise of one workload does not inherit the
 * permissions of the others, and the audit trail names the actual caller.
 *
 * No workload ever holds a secret to authenticate to Azure. Container Apps
 * resolves Key Vault references with these identities; on AKS the same
 * identities are federated to Kubernetes service accounts by the runtime-aks
 * module, which owns the federation because only it knows the cluster's OIDC
 * issuer and the exact ServiceAccount names the subject must match.
 */

resource "azurerm_user_assigned_identity" "main" {
  for_each            = var.identities
  name                = each.value
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

variable "project" {
  description = "Project slug."
  type        = string
}

variable "env" {
  description = "Environment name."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "names" {
  description = "Resource names from the naming module."
  type        = map(string)
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
}

variable "aks_subnet_id" {
  description = "Subnet hosting the node pools. Must NOT be delegated, and must be associated with the NAT Gateway to keep the egress IP fixed."
  type        = string
}

variable "kubernetes_version" {
  description = "Control-plane version. Patch upgrades are applied automatically by the platform; minor upgrades are a deliberate change here."
  type        = string
  default     = "1.34"
}

variable "private_cluster_enabled" {
  description = "Hide the API server from the internet. The CI then reaches it with `az aks command invoke`."
  type        = bool
  default     = true
}

variable "sku_tier" {
  description = "Control-plane tier. \"Free\" has no SLA; \"Standard\" adds the 99.95% uptime SLA (~65 USD/month). Kept on Free under a tight budget."
  type        = string
  default     = "Free"

  validation {
    condition     = contains(["Free", "Standard"], var.sku_tier)
    error_message = "sku_tier must be \"Free\" or \"Standard\"."
  }
}

# ─── Networking ────────────────────────────────────────────

variable "pod_cidr" {
  description = "Overlay CIDR for pods. Outside the VNet by design, so it may overlap between environments."
  type        = string
  default     = "10.244.0.0/16"
}

variable "service_cidr" {
  description = "ClusterIP range. Must not overlap the VNet."
  type        = string
  default     = "10.245.0.0/16"
}

# ─── Node pools ────────────────────────────────────────────

variable "system_node_vm_size" {
  description = "System pool VM size — hosts CoreDNS, metrics-server and the add-ons only."
  type        = string
  default     = "Standard_D2s_v5"
}

variable "system_node_count" {
  description = "System pool size. 2 minimum in prod for the control-plane SLA to mean anything."
  type        = number
  default     = 2
}

variable "user_node_vm_size" {
  description = "Application pool VM size."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "enable_user_pool" {
  description = "Create a dedicated application node pool. False runs the app on the system pool (single-pool cluster) — used on tiny environments to fit a small vCPU quota."
  type        = bool
  default     = true
}

variable "user_node_min_count" {
  description = "Autoscaler floor for the application pool."
  type        = number
  default     = 1
}

variable "user_node_max_count" {
  description = "Autoscaler ceiling for the application pool."
  type        = number
  default     = 4
}

variable "zone_redundant" {
  description = "Spread node pools across availability zones."
  type        = bool
  default     = false
}

# ─── Identity and access ───────────────────────────────────

variable "admin_group_object_ids" {
  description = "Entra group object ids granted cluster-admin through Azure RBAC. Empty means only subscription-level RBAC applies."
  type        = list(string)
  default     = []
}

variable "workload_identities" {
  description = <<-DESC
    ServiceAccount name → managed identity resource id.

    The key becomes the `subject` of the federated credential
    (system:serviceaccount:<namespace>:<key>), so it MUST match the
    ServiceAccount name declared in k8s/base exactly — a typo here fails at
    token exchange time, not at apply time.
  DESC
  type        = map(string)
  default     = {}
}

variable "kubernetes_namespace" {
  description = "Namespace holding the application workloads."
  type        = string
  default     = "diav1"
}

variable "acr_id" {
  description = "Registry resource id, granted AcrPull for the kubelet identity."
  type        = string
  default     = ""
}

variable "ingress_pip_id" {
  description = "Resource id of the pre-created ingress public IP. The cluster identity is granted Network Contributor on it so the ingress load balancer can adopt it. Empty skips the grant."
  type        = string
  default     = ""
}

variable "ingress_pip_name" {
  description = "Name of the pre-created ingress public IP, injected into the ingress-nginx Service (platform layer) through Flux substitution."
  type        = string
  default     = ""
}

variable "app_substitutions" {
  description = <<-DESC
    Values Flux injects into k8s/overlays/<env> at reconcile time
    (post_build.substitute), in place of what used to be hand-filled
    placeholders: the ACR host, workload-identity client ids, Key Vault name,
    tenant id, Front Door id and the public config URLs. All non-secret — this
    is what makes `terraform apply` the only step before the app deploys.
  DESC
  type        = map(string)
  default     = {}
}

variable "deployer_principal_id" {
  description = <<-DESC
    Object id of the principal the CI/CD pipeline deploys with (the Terraform
    service principal). It is granted the two roles the k8s-deploy workflow
    needs: the control-plane run-command permission to reach a private API
    server through `az aks command invoke`, and the in-cluster Azure RBAC to
    act inside the namespace. Empty skips the assignments — for when cluster
    access is managed solely through an admin group.
  DESC
  type        = string
  default     = ""
}

# ─── Observability ─────────────────────────────────────────

variable "log_analytics_workspace_id" {
  description = "Workspace receiving Container Insights and control-plane logs."
  type        = string
}

# ─── GitOps ────────────────────────────────────────────────

variable "gitops_enabled" {
  description = "Bootstrap Flux and point it at the repository. Disable to drive deployments from the CI with kubectl instead."
  type        = bool
  default     = true
}

variable "gitops_repository_url" {
  description = "Repository Flux reconciles from."
  type        = string
  default     = "https://github.com/fidelensadi/tbi_pfizer.git"
}

variable "gitops_branch" {
  description = "Branch Flux tracks."
  type        = string
  default     = "main"
}

variable "grant_acr_pull" {
  description = "Assign AcrPull to the kubelet identity on acr_id. Plan-time boolean rather than a check on the computed registry id."
  type        = bool
  default     = true
}

variable "grant_ingress_ip_role" {
  description = "Grant the cluster identity Network Contributor on the pre-created ingress public IP. Plan-time boolean rather than a check on the computed IP id."
  type        = bool
  default     = true
}

variable "gitops_use_deploy_key" {
  description = "Authenticate Flux to the repository with a Terraform-generated read-only deploy key. Required for a private repository; the URL must then be the ssh:// form."
  type        = bool
  default     = false
}

variable "system_autoscaling_enabled" {
  description = "Autoscale the system node pool between system_node_min_count and system_node_max_count. When false the pool is pinned to system_node_count."
  type        = bool
  default     = false
}

variable "system_node_min_count" {
  description = "Autoscaler floor for the system pool."
  type        = number
  default     = 1
}

variable "system_node_max_count" {
  description = "Autoscaler ceiling for the system pool."
  type        = number
  default     = 2
}

variable "system_pool_dedicated" {
  description = "Taint the system pool so only critical add-ons run on it. Set false to let application pods share it — halves the node count on a small environment, at the cost of a noisy workload being able to disturb CoreDNS."
  type        = bool
  default     = true
}

variable "acme_email" {
  description = "Adresse du compte ACME, substituée dans le ClusterIssuer de la couche platform."
  type        = string
  default     = ""
}

variable "enable_container_insights" {
  description = "Agent Container Insights et Prometheus managé sur le cluster. Faux libère ~1470 mCPU de réservations, ce qui permet de tenir sur un nœud unique."
  type        = bool
  default     = true
}

variable "user_autoscaling_enabled" {
  description = "Autoscaler le pool applicatif. Faux fixe le nombre de nœuds à user_node_count."
  type        = bool
  default     = true
}

variable "user_node_count" {
  description = "Nombre de nœuds du pool applicatif quand l'autoscale est désactivé."
  type        = number
  default     = 1
}

variable "ingress_host" {
  description = "Nom public servi par l'ingress. Substitué dans la réécriture CoreDNS et dans le bloc TLS de l'Ingress."
  type        = string
  default     = ""
}

variable "gitops_https_token" {
  description = "Jeton GitHub utilisé par Flux pour cloner en HTTPS. Alternative à la clé de déploiement quand on n'a pas les droits admin sur le dépôt. Vide = clé SSH."
  type        = string
  default     = ""
  sensitive   = true
}

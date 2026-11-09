// ─── Identity of the environment ──────────────────────────

variable "project" {
  description = "Project slug."
  type        = string
  default     = "diav1"
}

variable "env" {
  description = "Environment: dev, staging or prod."
  type        = string
}

variable "location" {
  description = "Azure region for the platform."
  type        = string
  default     = "westeurope"
}

variable "subscription_id" {
  description = "Target subscription."
  type        = string
}

variable "owner" {
  description = "Accountable team."
  type        = string
  default     = "solisbg"
}

variable "cost_center" {
  description = "Cost center tag."
  type        = string
  default     = "diav1"
}

variable "data_classification" {
  description = "Data sensitivity tag."
  type        = string
  default     = "internal"
}

// ─── Network ──────────────────────────────────────────────

variable "address_space" {
  description = "VNet CIDR. Keep environments non-overlapping in case they ever need to peer."
  type        = string
  default     = "10.20.0.0/16"
}

variable "zone_redundant" {
  description = "Zone redundancy for the egress IP and the runtime environment."
  type        = bool
  default     = false
}

// ─── Sizing: data ─────────────────────────────────────────

variable "postgres_sku" {
  description = "PostgreSQL compute tier."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage in MB."
  type        = number
  default     = 32768
}

variable "postgres_backup_retention_days" {
  description = "Point-in-time restore window."
  type        = number
  default     = 7
}

variable "postgres_geo_redundant" {
  description = "Geo-redundant backups."
  type        = bool
  default     = false
}

variable "postgres_high_availability" {
  description = "Zone-redundant standby."
  type        = bool
  default     = false
}

variable "redis_sku" {
  description = "Redis tier."
  type        = string
  default     = "Basic"
}

variable "redis_capacity" {
  description = "Redis size within the tier."
  type        = number
  default     = 0
}

variable "storage_replication" {
  description = "LRS or ZRS."
  type        = string
  default     = "LRS"
}

variable "acr_sku" {
  description = "Registry tier."
  type        = string
  default     = "Basic"
}

// ─── Orchestrator ─────────────────────────────────────────

variable "orchestrator" {
  description = <<-DESC
    Which runtime hosts the workloads: "aca" (Azure Container Apps) or "aks"
    (managed Kubernetes).

    The two modules expose the same contract, and every other component is
    shared, so switching is a variable change rather than a redesign. AKS costs
    roughly 400-800 EUR/month more in production and carries real operational
    load (2-3 version upgrades a year, node patching, quotas); it earns that
    when the cluster is shared with other applications, when sidecars, service
    mesh or DaemonSets are needed, or beyond about five independently deployed
    services.
  DESC
  type        = string
  default     = "aks"

  validation {
    condition     = contains(["aca", "aks"], var.orchestrator)
    error_message = "orchestrator must be \"aca\" or \"aks\"."
  }
}

variable "kubernetes_version" {
  description = "AKS control-plane version."
  type        = string
  default     = "1.34"
}

variable "aks_private_cluster" {
  description = "Hide the API server from the internet."
  type        = bool
  default     = true
}

variable "aks_sku_tier" {
  description = "AKS control-plane tier: \"Free\" (no SLA) or \"Standard\" (99.95% SLA, ~65 USD/month)."
  type        = string
  default     = "Free"
}

variable "aks_system_node_vm_size" {
  description = "System node pool VM size."
  type        = string
  default     = "Standard_D2s_v5"
}

variable "aks_system_node_count" {
  description = "System node pool size."
  type        = number
  default     = 2
}

variable "aks_user_node_vm_size" {
  description = "Application node pool VM size."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "aks_user_node_min_count" {
  description = "Autoscaler floor for the application pool."
  type        = number
  default     = 1
}

variable "aks_user_node_max_count" {
  description = "Autoscaler ceiling for the application pool."
  type        = number
  default     = 4
}

variable "aks_admin_group_object_ids" {
  description = "Entra groups granted cluster-admin through Azure RBAC."
  type        = list(string)
  default     = []
}

variable "aks_ingress_hostname" {
  description = <<-DESC
    Optional override for the Front Door origin on AKS.

    Normally left empty: the ingress binds a static public IP that Terraform
    pre-creates (module.network.ingress_ip), so the origin is known at plan time
    and no second apply is needed. Set this only to put a different hostname in
    front of the ingress — a custom edge or an external load balancer.
  DESC
  type        = string
  default     = ""
}

// ─── GitOps ───────────────────────────────────────────────

variable "gitops_enabled" {
  description = "Bootstrap Flux to reconcile k8s/overlays/<env>. AKS only."
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

// ─── Sizing: runtime ──────────────────────────────────────

variable "image_tag" {
  description = "Container image tag deployed. Set by the CI to sha-<short>."
  type        = string
  default     = "latest"
}

variable "web_min_replicas" {
  description = "Web replicas floor."
  type        = number
  default     = 1
}

variable "web_max_replicas" {
  description = "Web replicas ceiling."
  type        = number
  default     = 3
}

variable "web_cpu" {
  description = "vCPU per web replica."
  type        = number
  default     = 0.5
}

variable "web_memory" {
  description = "Memory per web replica."
  type        = string
  default     = "1Gi"
}

variable "ai_max_replicas" {
  description = "AI replicas ceiling."
  type        = number
  default     = 2
}

variable "ai_cpu" {
  description = "vCPU per AI replica."
  type        = number
  default     = 0.5
}

variable "ai_memory" {
  description = "Memory per AI replica."
  type        = string
  default     = "1Gi"
}

// ─── Edge ─────────────────────────────────────────────────

variable "frontdoor_sku" {
  description = "Front Door tier. Premium unlocks Private Link origins and managed OWASP rules."
  type        = string
  default     = "Standard_AzureFrontDoor"
}

variable "custom_domain" {
  description = "Public hostname. Empty uses the default azurefd.net endpoint."
  type        = string
  default     = ""
}

variable "waf_mode" {
  description = "Prevention or Detection."
  type        = string
  default     = "Prevention"
}

// ─── Observability ────────────────────────────────────────

variable "log_retention_days" {
  description = "Log Analytics retention."
  type        = number
  default     = 30
}

variable "alert_emails" {
  description = "Alert and budget recipients."
  type        = list(string)
  default     = []
}

variable "monthly_budget_eur" {
  description = "Monthly budget for the environment. 0 disables it."
  type        = number
  default     = 0
}

// ─── Governance ───────────────────────────────────────────

variable "enforce_policies" {
  description = "Assign the deny policies."
  type        = bool
  default     = true
}

variable "enable_deletion_locks" {
  description = "CanNotDelete locks on the database, vault and storage. Prod only."
  type        = bool
  default     = false
}

variable "key_vault_retention_days" {
  description = "Key Vault soft-delete window."
  type        = number
  default     = 90
}

variable "key_vault_purge_protection" {
  description = "Irreversible once enabled. Prod only."
  type        = bool
  default     = false
}

variable "defender_plans" {
  description = "Microsoft Defender plans to enable."
  type        = set(string)
  default     = []
}

// ─── Azure OpenAI ─────────────────────────────────────────

variable "enable_openai" {
  description = "Provision an Azure OpenAI account and model deployments. Disable to use the external OpenAI API (via the openai-api-key secret) instead — required on subscriptions with no Azure OpenAI quota."
  type        = bool
  default     = true
}

variable "openai_location" {
  description = "Region hosting Azure OpenAI. Kept separate because not every region offers it."
  type        = string
  default     = "westeurope"
}

variable "openai_deployments" {
  description = "Model deployments. Capacity is in thousands of tokens per minute and is capped by the subscription quota."
  type = map(object({
    model    = string
    version  = string
    sku      = string
    capacity = number
  }))
  default = {
    "gpt-4o-mini" = { model = "gpt-4o-mini", version = "2024-07-18", sku = "GlobalStandard", capacity = 30 }
    "gpt-4o"      = { model = "gpt-4o", version = "2024-11-20", sku = "GlobalStandard", capacity = 20 }
  }
}

variable "openai_model" {
  description = "Deployment used for the response the user reads."
  type        = string
  default     = "gpt-4o"
}

variable "openai_model_fast" {
  description = "Deployment used for classification and clarification."
  type        = string
  default     = "gpt-4o-mini"
}

// ─── Application configuration (non-secret) ───────────────

variable "dhis2_base_url" {
  description = "SNIS RDC base URL."
  type        = string
  default     = ""
}

variable "dhis2_username" {
  description = "SNIS RDC user."
  type        = string
  default     = ""
}

variable "dhis2_root_ou" {
  description = "National org unit id."
  type        = string
  default     = "ymGeqzoPhN3"
}

variable "supabase_url" {
  description = "Supabase project URL — identity provider in phase 1."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Supabase anon key. Public by design."
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "Web push public key. Public by design."
  type        = string
  default     = ""
}

// ─── Secrets (TF_VAR_* from GitHub Environment Secrets) ───

variable "openai_api_key" {
  description = "OpenAI key, for the non-Azure path."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dhis2_password" {
  description = "SNIS RDC password."
  type        = string
  default     = ""
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend key for transactional e-mail."
  type        = string
  default     = ""
  sensitive   = true
}

variable "elevenlabs_api_key" {
  description = "ElevenLabs key for speech-to-text."
  type        = string
  default     = ""
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service role key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vapid_private_key" {
  description = "Web push private key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_managed_redis" {
  description = <<-DESC
    Provision Azure Managed Redis instead of running Redis inside the cluster.

    Off by default: Azure Cache for Redis is retired and no longer creatable,
    and its replacement starts in the hundreds of euros a month. The in-cluster
    pod costs nothing and holds only reconstructible data.
  DESC
  type        = bool
  default     = false
}

variable "kubernetes_namespace" {
  description = "Namespace hosting the workloads — used to build the in-cluster Redis URL."
  type        = string
  default     = "diav1"
}

variable "key_vault_public_access" {
  description = "Keep the Key Vault data plane reachable for the deployer. The firewall still denies everything except key_vault_allowed_ips."
  type        = bool
  default     = true
}

variable "key_vault_allowed_ips" {
  description = "Public addresses allowed through the Key Vault firewall — the address Terraform runs from."
  type        = list(string)
  default     = []
}

variable "enable_frontdoor" {
  description = <<-DESC
    Provision Azure Front Door (CDN, WAF, edge caching, TLS).

    Disable when the subscription has no Front Door profile quota — it starts
    at zero and is raised by a support request. The ingress public IP then
    serves traffic directly, without WAF or edge caching.
  DESC
  type        = bool
  default     = true
}

variable "enable_etl_freshness_alert" {
  description = "Create the ETL freshness alert. Its KQL is validated against existing Log Analytics tables, so it only works once the cluster has shipped logs — enable on a later apply."
  type        = bool
  default     = false
}

variable "gitops_use_deploy_key" {
  description = "Authenticate Flux with a Terraform-generated read-only deploy key. Required when the repository is private; the URL is rewritten to its ssh:// form."
  type        = bool
  default     = false
}

variable "aks_system_autoscaling_enabled" {
  description = "Autoscale the AKS system node pool."
  type        = bool
  default     = false
}

variable "aks_system_node_min_count" {
  description = "Autoscaler floor for the system pool."
  type        = number
  default     = 1
}

variable "aks_system_node_max_count" {
  description = "Autoscaler ceiling for the system pool."
  type        = number
  default     = 2
}

variable "aks_enable_user_pool" {
  description = "Create a dedicated application node pool. False runs the app on the system pool (single-pool cluster), to fit a small vCPU quota."
  type        = bool
  default     = true
}

variable "aks_system_pool_dedicated" {
  description = "Reserve the system pool for critical add-ons. False lets application pods share it."
  type        = bool
  default     = true
}

variable "acme_email" {
  description = "Adresse du compte ACME Let's Encrypt, destinataire des avis d'expiration. Facultative : vide, le compte est anonyme."
  type        = string
  default     = ""
}

variable "enable_container_insights" {
  description = "Container Insights + Prometheus managé sur AKS. À éteindre sur les environnements dimensionnés au plus juste : la pile réserve plus de CPU que l'application."
  type        = bool
  default     = true
}

variable "aks_user_autoscaling_enabled" {
  description = "Autoscaler le pool applicatif AKS. Faux fixe le nombre de nœuds à aks_user_node_count."
  type        = bool
  default     = true
}

variable "aks_user_node_count" {
  description = "Nombre de nœuds du pool applicatif quand l'autoscale est désactivé."
  type        = number
  default     = 1
}

variable "gitops_https_token" {
  description = "Jeton GitHub pour que Flux clone en HTTPS. Rend le bootstrap reproductible sans droits admin sur le dépôt."
  type        = string
  default     = ""
  sensitive   = true
}

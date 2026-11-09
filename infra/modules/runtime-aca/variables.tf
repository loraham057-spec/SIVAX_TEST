variable "project" {
  description = "Project slug — used to build image names."
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

variable "runtime_subnet_id" {
  description = "Subnet delegated to Microsoft.App/environments."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace collecting container logs."
  type        = string
}

variable "zone_redundant" {
  description = "Spread the environment across zones. Prod only."
  type        = bool
  default     = false
}

variable "identity_ids" {
  description = "User-assigned identity resource ids, keyed by role (web, ai, jobs)."
  type        = map(string)
}

variable "acr_login_server" {
  description = "Registry host."
  type        = string
}

variable "image_tag" {
  description = "Image tag deployed by the CI, normally sha-<short>. Never 'latest' — a tag that moves makes rollbacks ambiguous."
  type        = string
  default     = "latest"
}

variable "key_vault_secret_ids" {
  description = "Versionless Key Vault secret ids, keyed by secret name. Values never appear in the container definition."
  type        = map(string)
}

variable "public_hostname" {
  description = "Public hostname served by Front Door."
  type        = string
}

# ─── Sizing ────────────────────────────────────────────────

variable "web_min_replicas" {
  description = "Web replicas floor. 0 is fine in dev; use 1 or more in prod to avoid cold starts."
  type        = number
  default     = 1
}

variable "web_max_replicas" {
  description = "Web replicas ceiling."
  type        = number
  default     = 5
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
  description = "AI replicas ceiling. The floor is pinned to 1 in code."
  type        = number
  default     = 3
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

# ─── Schedules ─────────────────────────────────────────────

variable "etl_cron" {
  description = "Mid-week sync of the last 3 complete months (Wednesday). 03:00 UTC is the low-load window on SNIS RDC. The Sunday full sync covers the rest of the week."
  type        = string
  default     = "0 3 * * 3"
}

variable "etl_full_cron" {
  description = "Sunday sync (3 last complete months incl. thematic zones) — weekend, when both sides are quiet."
  type        = string
  default     = "0 4 * * 0"
}

variable "etl_annual_cron" {
  description = "Yearly aggregates + population sync — 1st of the month, after the Wednesday/Sunday windows."
  type        = string
  default     = "0 8 1 * *"
}

# ─── Application configuration ─────────────────────────────

variable "openai_model" {
  description = "Deployment name used for the node the user actually reads."
  type        = string
  default     = "gpt-4o"
}

variable "openai_model_fast" {
  description = "Deployment name used for classification, clarification and fact-check regeneration."
  type        = string
  default     = "gpt-4o-mini"
}

variable "dhis2_base_url" {
  description = "SNIS RDC base URL."
  type        = string
  default     = ""
}

variable "dhis2_username" {
  description = "SNIS RDC user. The password is a Key Vault reference."
  type        = string
  default     = ""
}

variable "dhis2_root_ou" {
  description = "National org unit id."
  type        = string
  default     = "ymGeqzoPhN3"
}

variable "supabase_url" {
  description = "Supabase project URL — kept as identity provider in phase 1."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Supabase anon key. Public by design (it is shipped to the browser)."
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "Web push public key. Public by design."
  type        = string
  default     = ""
}

variable "assets_base_url" {
  description = "Base URL of the static assets container."
  type        = string
  default     = ""
}

variable "app_insights_connection_string" {
  description = "Application Insights connection string."
  type        = string
  default     = ""
  sensitive   = true
}

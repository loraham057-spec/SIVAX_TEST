// Inputs common to every environment. Non-secret values come from
// terraform.tfvars; secrets arrive as TF_VAR_* from GitHub Environment Secrets
// and must never be written to a tfvars file.

variable "project" {
  description = "Project slug."
  type        = string
  default     = "diav1"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}

variable "subscription_id" {
  description = "Target subscription."
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy. Set by the CI to sha-<short>."
  type        = string
  default     = "latest"
}

variable "alert_emails" {
  description = "Alert and budget recipients."
  type        = list(string)
  default     = []
}

variable "openai_location" {
  description = "Region hosting Azure OpenAI."
  type        = string
  default     = "westeurope"
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
  description = "Supabase project URL."
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

// ─── Secrets (TF_VAR_*) ───────────────────────────────────

variable "openai_api_key" {
  description = "OpenAI key."
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
  description = "Resend key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "elevenlabs_api_key" {
  description = "ElevenLabs key."
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

variable "custom_domain" {
  description = "Public hostname served by Front Door. Empty uses the default azurefd.net endpoint."
  type        = string
  default     = ""
}

variable "orchestrator" {
  description = "Runtime hosting the workloads: \"aks\" (managed Kubernetes, default) or \"aca\" (Container Apps)."
  type        = string
  default     = "aks"
}

variable "aks_ingress_hostname" {
  description = "Optional override for the Front Door origin on AKS. Leave empty to use the static ingress IP Terraform pre-creates."
  type        = string
  default     = ""
}

variable "aks_admin_group_object_ids" {
  description = "Entra groups granted cluster-admin through Azure RBAC."
  type        = list(string)
  default     = []
}

variable "use_oidc" {
  description = "Authenticate to Azure with GitHub OIDC federation. Set false to use a service principal client secret (ARM_CLIENT_SECRET) locally."
  type        = bool
  default     = true
}

variable "enable_frontdoor" {
  description = "Provision Azure Front Door. Disable when the subscription has no profile quota."
  type        = bool
  default     = true
}

variable "key_vault_allowed_ips" {
  description = "Public addresses allowed through the Key Vault firewall — the address Terraform runs from."
  type        = list(string)
  default     = []
}

variable "acme_email" {
  description = "Adresse du compte ACME Let's Encrypt pour le certificat de l'ingress."
  type        = string
  default     = ""
}

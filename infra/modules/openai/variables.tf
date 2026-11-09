variable "name" {
  description = "Cognitive account name — also used as the custom subdomain, so it must be globally unique."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group."
  type        = string
}

variable "location" {
  description = "Region hosting Azure OpenAI. May differ from the platform region: not every region offers the service."
  type        = string
  default     = "westeurope"
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
}

variable "deployments" {
  description = <<-DESC
    Model deployments, keyed by deployment name. The keys are what the
    application passes as OPENAI_MODEL / OPENAI_MODEL_FAST.

    `capacity` is expressed in thousands of tokens per minute and is capped by
    the quota granted to the subscription — Terraform cannot raise that ceiling.
  DESC
  type = map(object({
    model    = string
    version  = string
    sku      = string
    capacity = number
  }))
  default = {
    "gpt-4o-mini" = {
      model    = "gpt-4o-mini"
      version  = "2024-07-18"
      sku      = "GlobalStandard"
      capacity = 30
    }
    "gpt-4o" = {
      model    = "gpt-4o"
      version  = "2024-11-20"
      sku      = "GlobalStandard"
      capacity = 20
    }
  }
}

variable "public_network_access_enabled" {
  description = "Disable in prod so the account is reachable only through its private endpoint."
  type        = bool
  default     = true
}

variable "local_auth_enabled" {
  description = "Allow API-key authentication. Disable once every caller uses a managed identity."
  type        = bool
  default     = true
}

variable "private_endpoint_subnet_id" {
  description = "Subnet hosting the private endpoint."
  type        = string
  default     = ""
}

variable "private_dns_zone_id" {
  description = "privatelink.openai.azure.com zone id."
  type        = string
  default     = ""
}

variable "user_principal_ids" {
  description = "Identities granted Cognitive Services OpenAI User."
  type        = map(string)
  default     = {}
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving request logs. Empty disables diagnostics."
  type        = string
  default     = ""
}

variable "enable_diagnostics" {
  description = "Send diagnostics to Log Analytics. A plan-time boolean, not a check on the computed workspace id."
  type        = bool
  default     = true
}

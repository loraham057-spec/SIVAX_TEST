variable "resource_group_name" {
  description = "Resource group."
  type        = string
}

variable "location" {
  description = "Region of the Private Link target."
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

variable "sku_name" {
  description = "Standard_AzureFrontDoor or Premium_AzureFrontDoor. Premium is required for Private Link origins and managed OWASP rulesets."
  type        = string
  default     = "Standard_AzureFrontDoor"

  validation {
    condition     = contains(["Standard_AzureFrontDoor", "Premium_AzureFrontDoor"], var.sku_name)
    error_message = "sku_name must be Standard_AzureFrontDoor or Premium_AzureFrontDoor."
  }
}

variable "app_origin_host" {
  description = "Hostname of the application origin (the web container app FQDN)."
  type        = string
}

variable "app_private_link_target_id" {
  description = "Resource id of the Private Link target. Premium only; empty disables Private Link."
  type        = string
  default     = ""
}

variable "assets_origin_host" {
  description = "Blob endpoint host serving /geo/* and /images/*. Empty disables the assets route."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Public hostname, e.g. tbi.solisbg.com. Empty uses the default azurefd.net endpoint."
  type        = string
  default     = ""
}

variable "waf_mode" {
  description = "Prevention blocks matching requests; Detection only logs them. Start in Detection when tuning."
  type        = string
  default     = "Prevention"

  validation {
    condition     = contains(["Prevention", "Detection"], var.waf_mode)
    error_message = "waf_mode must be Prevention or Detection."
  }
}

variable "assistant_rate_limit" {
  description = "Requests per minute per IP on /api/assistant — the billed LLM and STT path."
  type        = number
  default     = 30
}

variable "api_rate_limit" {
  description = "Requests per minute per IP on the rest of /api/."
  type        = number
  default     = 300
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving access and WAF logs. Empty disables diagnostics."
  type        = string
  default     = ""
}

variable "enable_diagnostics" {
  description = "Send diagnostics to Log Analytics. A plan-time boolean, not a check on the computed workspace id."
  type        = bool
  default     = true
}

variable "enable_assets_origin" {
  description = "Wire the static-assets origin, route and caching rules. A plan-time boolean, not a check on the computed assets host."
  type        = bool
  default     = true
}

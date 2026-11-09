variable "name" {
  description = "Cache name."
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

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
}

variable "sku_name" {
  description = "Basic (dev, no SLA), Standard (replicated) or Premium."
  type        = string
  default     = "Basic"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.sku_name)
    error_message = "sku_name must be Basic, Standard or Premium."
  }
}

variable "family" {
  description = "C for Basic/Standard, P for Premium."
  type        = string
  default     = "C"
}

variable "capacity" {
  description = "Size within the family. 0 = 250MB, 1 = 1GB."
  type        = number
  default     = 0
}

variable "private_endpoint_subnet_id" {
  description = "Subnet hosting the private endpoint."
  type        = string
}

variable "private_dns_zone_id" {
  description = "privatelink.redis.cache.windows.net zone id."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving metrics. Empty disables diagnostics."
  type        = string
  default     = ""
}

variable "enable_diagnostics" {
  description = "Send diagnostics to Log Analytics. A plan-time boolean, not a check on the computed workspace id."
  type        = bool
  default     = true
}

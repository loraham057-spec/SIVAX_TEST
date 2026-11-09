variable "project" {
  description = "Project slug used in every resource name."
  type        = string
  default     = "diav1"

  validation {
    condition     = can(regex("^[a-z0-9]{3,10}$", var.project))
    error_message = "project must be 3-10 lowercase alphanumeric characters (it goes into globally-unique names)."
  }
}

variable "env" {
  description = "Environment name: dev, staging or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of: dev, staging, prod."
  }
}

variable "location" {
  description = "Azure region. westeurope is the default: it carries the widest service catalogue and the most reliable Azure OpenAI availability."
  type        = string
  default     = "westeurope"
}

variable "subscription_id" {
  description = "Subscription id — used only to derive a deterministic suffix for globally-unique names."
  type        = string
}

variable "owner" {
  description = "Team or person accountable for the environment."
  type        = string
  default     = "solisbg"
}

variable "cost_center" {
  description = "Cost center tag, used by the consumption budgets."
  type        = string
  default     = "diav1"
}

variable "data_classification" {
  description = "Data sensitivity tag. Aggregated province/national health data is not personal data; raise this if drill-down to facility level is enabled."
  type        = string
  default     = "internal"
}

variable "extra_tags" {
  description = "Additional tags merged into every resource."
  type        = map(string)
  default     = {}
}

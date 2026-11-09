variable "resource_group_name" {
  description = "Resource group."
  type        = string
}

variable "resource_group_id" {
  description = "Resource group id — scope of the consumption budget."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "env" {
  description = "Environment name, used in alert names."
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

variable "retention_days" {
  description = "Log retention. 30 days is enough for dev; prod keeps 90."
  type        = number
  default     = 30
}

variable "alert_emails" {
  description = "Recipients of every alert and budget notification."
  type        = list(string)
  default     = []
}

variable "alert_webhook_url" {
  description = "Optional webhook — points at the platform's own /api/push/send so infrastructure alerts reach the same audience as health alerts."
  type        = string
  default     = ""
}

variable "frontdoor_profile_id" {
  description = "Front Door profile id. Empty skips the edge alerts."
  type        = string
  default     = ""
}

variable "postgres_server_id" {
  description = "PostgreSQL server id. Empty skips the database alerts."
  type        = string
  default     = ""
}

variable "monthly_budget_eur" {
  description = "Monthly budget for the resource group. 0 disables the budget."
  type        = number
  default     = 0
}

variable "enable_frontdoor_alerts" {
  description = "Create the Front Door 5xx/latency alerts. Plan-time boolean rather than a check on the computed profile id."
  type        = bool
  default     = true
}

variable "enable_postgres_alerts" {
  description = "Create the PostgreSQL CPU/storage alerts. Plan-time boolean rather than a check on the computed server id."
  type        = bool
  default     = true
}

variable "enable_etl_freshness_alert" {
  description = "Create the \"no successful ETL in 26h\" alert. Azure validates its KQL against existing tables, and ContainerLogV2 only appears once the cluster has shipped its first logs — so enable this on a later apply, not the first."
  type        = bool
  default     = false
}

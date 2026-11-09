variable "name" {
  description = "Key Vault name (globally unique, 24 chars max)."
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

variable "tenant_id" {
  description = "Entra tenant id."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
}

variable "private_endpoint_subnet_id" {
  description = "Subnet hosting the private endpoint."
  type        = string
}

variable "private_dns_zone_id" {
  description = "privatelink.vaultcore.azure.net zone id."
  type        = string
}

variable "terraform_principal_id" {
  description = "Object id of the principal running Terraform — needs Secrets Officer to write the secrets it manages."
  type        = string
}

variable "reader_principal_ids" {
  description = "Workload identities granted read access, keyed by role."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Third-party secret values, supplied through TF_VAR_* from GitHub Environment Secrets. Values must be known at plan (a literal or empty); empties are skipped."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "computed_secrets" {
  description = "Secrets whose values are composed from other resources (connection strings) and are therefore unknown at plan. Always stored — never used to drive for_each keys or an if filter."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "enable_diagnostics" {
  description = "Send Key Vault audit logs to Log Analytics. A plan-time boolean rather than a check on the (computed) workspace id."
  type        = bool
  default     = true
}

variable "soft_delete_retention_days" {
  description = "Recovery window after deletion."
  type        = number
  default     = 90
}

variable "purge_protection_enabled" {
  description = "Prevents permanent deletion during the retention window. IRREVERSIBLE once enabled — prod only."
  type        = bool
  default     = false
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving the audit log. Empty disables diagnostics."
  type        = string
  default     = ""
}

variable "public_network_access_enabled" {
  description = "Keep the data plane reachable so Terraform, which runs outside the VNet, can write secrets. The firewall below still denies everything except allowed_ip_rules; workloads use the private endpoint."
  type        = bool
  default     = true
}

variable "allowed_ip_rules" {
  description = "Public addresses allowed through the Key Vault firewall — the deployer's IP. Empty means allow all, which is only acceptable if the vault is otherwise unreachable."
  type        = list(string)
  default     = []
}

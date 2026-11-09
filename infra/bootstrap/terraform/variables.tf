variable "subscription_id" {
  description = "Target subscription."
  type        = string
}

variable "project" {
  description = "Project slug."
  type        = string
  default     = "diav1"
}

variable "location" {
  description = "Region hosting the state account."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Resource group holding the state account. Must match backend.hcl."
  type        = string
  default     = "rg-diav1-tfstate"
}

variable "storage_account_name" {
  description = "State storage account. Globally unique, and must match backend.hcl."
  type        = string
  default     = "stdiav1tfstate"
}

variable "replication_type" {
  description = "LRS is enough for state; ZRS if the state must survive a zone loss."
  type        = string
  default     = "LRS"
}

variable "terraform_principal_object_id" {
  description = "Object id of the principal running Terraform, granted Storage Blob Data Contributor on the state account. Empty skips the assignment."
  type        = string
  default     = ""
}

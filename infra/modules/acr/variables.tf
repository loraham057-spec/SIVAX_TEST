variable "name" {
  description = "Registry name (globally unique, alphanumeric)."
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

variable "sku" {
  description = "Basic, Standard or Premium. Private endpoints and retention policies require Premium."
  type        = string
  default     = "Basic"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.sku)
    error_message = "sku must be Basic, Standard or Premium."
  }
}

variable "public_network_access_enabled" {
  description = "Premium only. Disabling it forces pulls through a private endpoint."
  type        = bool
  default     = true
}

variable "private_endpoint_subnet_id" {
  description = "Subnet hosting the private endpoint."
  type        = string
  default     = ""
}

variable "private_dns_zone_id" {
  description = "privatelink.azurecr.io zone id."
  type        = string
  default     = ""
}

variable "pull_principal_ids" {
  description = "Identities allowed to pull images (every workload)."
  type        = map(string)
  default     = {}
}

variable "push_principal_ids" {
  description = "Identities allowed to push images (the CI)."
  type        = map(string)
  default     = {}
}

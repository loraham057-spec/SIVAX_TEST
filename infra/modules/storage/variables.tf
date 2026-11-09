variable "name" {
  description = "Storage account name (globally unique, lowercase alphanumeric)."
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

variable "replication_type" {
  description = "LRS for dev, ZRS for prod."
  type        = string
  default     = "LRS"
}

variable "containers" {
  description = "Containers to create."
  type        = list(string)
  default     = ["assets", "exports", "ml-artifacts", "bulletins"]
}

variable "artifact_retention_days" {
  description = "Age at which exports and ML artefacts are deleted."
  type        = number
  default     = 365
}

variable "public_network_access_enabled" {
  description = "Front Door reaches the assets container over the public endpoint with an AzureServices bypass. Set false to force everything through a private endpoint (then assets must be served by the app instead)."
  type        = bool
  default     = true
}

variable "private_endpoint_subnet_id" {
  description = "Subnet hosting the private endpoint."
  type        = string
  default     = ""
}

variable "private_dns_zone_id" {
  description = "privatelink.blob.core.windows.net zone id."
  type        = string
  default     = ""
}

variable "contributor_principal_ids" {
  description = "Identities allowed to write blobs (ETL, ML jobs, exports)."
  type        = map(string)
  default     = {}
}

variable "reader_principal_ids" {
  description = "Identities allowed to read blobs."
  type        = map(string)
  default     = {}
}

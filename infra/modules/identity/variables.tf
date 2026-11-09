variable "resource_group_name" {
  description = "Resource group hosting the identities."
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

variable "identities" {
  description = "Logical role → identity name. Keys are used as map keys in the outputs (web, ai, jobs, cicd)."
  type        = map(string)
}

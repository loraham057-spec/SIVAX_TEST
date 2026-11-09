variable "resource_group_name" {
  description = "Resource group hosting the network."
  type        = string
}

variable "location" {
  description = "Azure region."
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

variable "address_space" {
  description = "VNet CIDR. Subnets are carved out of it deterministically: runtime /23, private endpoints /24, PostgreSQL /24."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.address_space, 8, 3))
    error_message = "address_space must be a CIDR block of /16 or larger."
  }
}

variable "frontdoor_enabled" {
  description = "Front Door fronts the ingress. False opens the node subnet's NSG to 80/443 from the internet, because the ingress public IP is then the only way in."
  type        = bool
  default     = true
}

variable "create_ingress_pip" {
  description = "Pre-create the static public IP for the AKS ingress, so the Front Door origin can be wired in the same apply. Set on the AKS runtime; leave off on Container Apps."
  type        = bool
  default     = false
}

variable "zone_redundant" {
  description = "Spread the egress IP across availability zones. Enabled in prod, off in dev to keep the bill down."
  type        = bool
  default     = false
}

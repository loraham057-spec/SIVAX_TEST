variable "resource_group_id" {
  description = "Resource group the policies are assigned to."
  type        = string
}

variable "enforce_policies" {
  description = "Assign the deny policies. Enabled from staging onwards; dev can opt out while iterating."
  type        = bool
  default     = true
}

variable "required_tags" {
  description = "Tags every resource must carry."
  type        = list(string)
  default     = ["project", "env", "owner", "cost-center", "data-classification"]
}

variable "locked_resource_ids" {
  description = "Resources protected by a CanNotDelete lock, keyed by a short label. Prod only."
  type        = map(string)
  default     = {}
}

variable "defender_plans" {
  description = "Microsoft Defender plans to enable. Empty disables Defender (dev)."
  type        = set(string)
  default     = []
}

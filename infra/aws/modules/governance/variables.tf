variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "region" {
  description = "Région AWS."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "block_public_s3_account_wide" {
  description = "Interdire tout accès public S3 au niveau du compte. Incompatible avec la lecture anonyme du préfixe assets/."
  type        = bool
  default     = false
}

variable "enable_guardduty" {
  description = "Activer GuardDuty. Un seul détecteur par compte et par région."
  type        = bool
  default     = false
}

variable "enable_security_hub" {
  description = "Activer Security Hub et le socle de bonnes pratiques."
  type        = bool
  default     = false
}

variable "enable_access_analyzer" {
  description = "Activer IAM Access Analyzer. Gratuit."
  type        = bool
  default     = true
}

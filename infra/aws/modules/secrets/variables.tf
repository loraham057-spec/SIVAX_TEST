variable "secret_prefix" {
  description = "Préfixe des noms de secrets, <projet>/<env>."
  type        = string
}

variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "secrets" {
  description = "Secrets tiers, valeurs connues au plan. Les entrées vides sont ignorées."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "computed_secrets" {
  description = "Secrets composés à partir d'autres ressources (chaînes de connexion) — inconnus au plan."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "reader_role_names" {
  description = "Rôles IAM autorisés à lire les secrets de l'environnement."
  type        = map(string)
  default     = {}
}

variable "recovery_window_days" {
  description = "Fenêtre de récupération après suppression. 0 rend le nom réutilisable immédiatement, ce qu'exige un environnement reconstructible ; 7 ou 30 protègent d'une suppression accidentelle."
  type        = number
  default     = 0

  validation {
    condition     = var.recovery_window_days == 0 || (var.recovery_window_days >= 7 && var.recovery_window_days <= 30)
    error_message = "recovery_window_days doit valoir 0, ou un entier entre 7 et 30."
  }
}

variable "create_kms_key" {
  description = "Créer une clé KMS propre à l'environnement pour les secrets et le chiffrement d'enveloppe des Secrets Kubernetes."
  type        = bool
  default     = false
}

variable "kms_deletion_window_days" {
  description = "Délai avant destruction effective de la clé KMS."
  type        = number
  default     = 7
}

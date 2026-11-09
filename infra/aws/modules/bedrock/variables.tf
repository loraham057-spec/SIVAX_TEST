variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "model_ids" {
  description = "Identifiants de modèles que les charges de travail peuvent invoquer."
  type        = list(string)
  default     = []
}

variable "user_role_names" {
  description = "Rôles IAM recevant le droit d'invoquer (ai, jobs)."
  type        = map(string)
  default     = {}
}

variable "enable_invocation_logging" {
  description = "Journaliser chaque invocation. Le réglage est unique par compte et par région."
  type        = bool
  default     = false
}

variable "log_prompt_text" {
  description = "Inclure le texte des invites dans les journaux. À laisser faux quand les invites peuvent contenir des données sensibles."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Rétention des journaux d'invocation."
  type        = number
  default     = 30
}

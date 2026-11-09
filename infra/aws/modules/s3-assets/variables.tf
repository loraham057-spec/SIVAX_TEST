variable "names" {
  description = "Noms de ressources issus du module naming."
  type        = map(string)
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "force_destroy" {
  description = "Autoriser la destruction d'un bucket non vide."
  type        = bool
  default     = false
}

variable "artifact_retention_days" {
  description = "Durée de conservation des exports et des artefacts ML."
  type        = number
  default     = 365
}

variable "assets_public_read" {
  description = "Ouvrir le préfixe assets/ en lecture anonyme. À laisser faux dès qu'un CDN sert le bucket."
  type        = bool
  default     = false
}

variable "allowed_origins" {
  description = "Origines autorisées en CORS pour les actifs."
  type        = list(string)
  default     = ["*"]
}

variable "kms_key_arn" {
  description = "Clé KMS chiffrant les objets. Vide, le chiffrement SSE-S3 s'applique."
  type        = string
  default     = ""
}

variable "contributor_role_names" {
  description = "Rôles IAM recevant l'écriture (jobs, web)."
  type        = map(string)
  default     = {}
}

variable "reader_role_names" {
  description = "Rôles IAM recevant la lecture seule (ai)."
  type        = map(string)
  default     = {}
}

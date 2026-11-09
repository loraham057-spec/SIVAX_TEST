variable "names" {
  description = "Noms de ressources issus du module naming."
  type        = map(string)
}

variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "image_tag_mutability" {
  description = "IMMUTABLE interdit de réécrire un tag déjà poussé — ce qui rend un déploiement reproductible. MUTABLE reste nécessaire si le pipeline pousse un tag flottant (latest)."
  type        = string
  default     = "MUTABLE"
}

variable "force_delete" {
  description = "Autoriser la destruction d'un dépôt qui contient encore des images. Vrai en dev, où l'environnement doit pouvoir être détruit et reconstruit sans geste manuel."
  type        = bool
  default     = false
}

variable "keep_last_images" {
  description = "Nombre d'images taguées sha- conservées par dépôt."
  type        = number
  default     = 20
}

variable "kms_key_arn" {
  description = "Clé KMS chiffrant les images. Vide, le chiffrement AES256 géré par ECR s'applique."
  type        = string
  default     = ""
}

variable "pull_principal_arns" {
  description = "Principaux autorisés à tirer, hors rôle des nœuds (qui porte déjà la politique managée)."
  type        = list(string)
  default     = []
}

variable "push_role_names" {
  description = "Rôles IAM recevant les droits de poussée — le rôle du pipeline."
  type        = list(string)
  default     = []
}

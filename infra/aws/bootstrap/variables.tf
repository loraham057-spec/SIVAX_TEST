variable "project" {
  description = "Slug du projet."
  type        = string
  default     = "diav1"
}

variable "region" {
  description = "Région hébergeant l'état. Elle n'a pas à être celle des environnements."
  type        = string
  default     = "eu-west-3"
}

variable "state_bucket_name" {
  description = "Nom du bucket d'état. Unique mondialement."
  type        = string
  default     = "diav1-tfstate"
}

variable "lock_table_name" {
  description = "Nom de la table de verrous."
  type        = string
  default     = "diav1-tfstate-lock"
}

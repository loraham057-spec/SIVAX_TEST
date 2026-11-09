variable "project" {
  description = "Slug du projet, présent dans chaque nom de ressource."
  type        = string
  default     = "diav1"

  validation {
    condition     = can(regex("^[a-z0-9]{3,10}$", var.project))
    error_message = "project doit faire 3 à 10 caractères alphanumériques minuscules (il entre dans des noms globalement uniques)."
  }
}

variable "env" {
  description = "Nom de l'environnement : dev, staging ou prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env doit valoir dev, staging ou prod."
  }
}

variable "region" {
  description = "Région AWS. eu-west-3 (Paris) par défaut : UE, francophone, et catalogue complet pour EKS/RDS/ElastiCache."
  type        = string
  default     = "eu-west-3"
}

variable "account_id" {
  description = "Identifiant du compte AWS — sert uniquement à dériver un suffixe déterministe pour les noms globalement uniques."
  type        = string
}

variable "owner" {
  description = "Équipe ou personne responsable de l'environnement."
  type        = string
  default     = "solisbg"
}

variable "cost_center" {
  description = "Tag de centre de coût, utilisé par le budget AWS."
  type        = string
  default     = "diav1"
}

variable "data_classification" {
  description = "Sensibilité des données. Les données agrégées province/national ne sont pas des données personnelles ; relever si le détail par structure est activé."
  type        = string
  default     = "internal"
}

variable "extra_tags" {
  description = "Tags additionnels fusionnés dans chaque ressource."
  type        = map(string)
  default     = {}
}

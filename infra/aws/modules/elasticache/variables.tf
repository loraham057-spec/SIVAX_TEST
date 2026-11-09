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

variable "subnet_ids" {
  description = "Sous-réseaux de données hébergeant le cache."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Groupes de sécurité du cache."
  type        = list(string)
}

variable "node_type" {
  description = "Type de nœud. cache.t4g.micro est le plancher utile."
  type        = string
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  description = "Version de Redis."
  type        = string
  default     = "7.1"
}

variable "parameter_group_family" {
  description = "Famille de groupe de paramètres, alignée sur la version du moteur."
  type        = string
  default     = "redis7"
}

variable "replica_count" {
  description = "Nombre de répliques en lecture. 0 signifie un nœud unique, sans bascule automatique."
  type        = number
  default     = 0
}

variable "snapshot_retention_days" {
  description = "Rétention des instantanés. 0 les désactive — acceptable pour un cache reconstructible."
  type        = number
  default     = 0
}

variable "apply_immediately" {
  description = "Appliquer les modifications sans attendre la fenêtre de maintenance."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Rétention des journaux du moteur."
  type        = number
  default     = 30
}

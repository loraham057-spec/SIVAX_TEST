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

variable "region" {
  description = "Région AWS."
  type        = string
}

variable "account_id" {
  description = "Compte AWS — composant de l'ARN rds-db utilisé par l'authentification IAM."
  type        = string
}

variable "subnet_ids" {
  description = "Sous-réseaux de données hébergeant l'instance."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Groupes de sécurité de l'instance."
  type        = list(string)
}

variable "engine_version" {
  description = <<-DESC
    Version de PostgreSQL. La MAJEURE seule, deliberement : RDS choisit alors la
    derniere mineure disponible, et le parc suit les correctifs sans qu'une
    valeur figee ici ne devienne un jour introuvable.

    C'est exactement ce qui est arrive avec « 16.4 » : la version a ete retiree
    du catalogue et la creation echouait sur
    « Cannot find version 16.4 for postgres », sans que rien n'ait change dans
    le code.
  DESC
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "Classe d'instance. db.t4g.micro suffit en dev ; t4g est en Graviton, moins cher à performance égale."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Stockage initial, en Go."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Plafond de la croissance automatique, en Go. Égal au stockage initial, la croissance est désactivée."
  type        = number
  default     = 100
}

variable "database_name" {
  description = "Nom de la base applicative."
  type        = string
}

variable "administrator_login" {
  description = "Utilisateur maître."
  type        = string
  default     = "diav1admin"
}

variable "administrator_password" {
  description = "Mot de passe maître, engendré par le module secrets."
  type        = string
  sensitive   = true
}

variable "multi_az" {
  description = "Réplique de secours dans une autre zone. Double le coût de l'instance."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Rétention des sauvegardes automatiques."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Refuser la suppression de l'instance. À activer une fois la plateforme porteuse."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Ne pas prendre d'instantané final à la destruction. Vrai en dev, où l'environnement doit se reconstruire sans résidu."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Appliquer les modifications sans attendre la fenêtre de maintenance."
  type        = bool
  default     = false
}

variable "performance_insights_enabled" {
  description = "Performance Insights. Gratuit sur sept jours de rétention."
  type        = bool
  default     = true
}

variable "monitoring_interval" {
  description = "Intervalle de la surveillance rapprochée, en secondes. 0 la désactive."
  type        = number
  default     = 0
}

variable "kms_key_arn" {
  description = "Clé KMS chiffrant le stockage. Vide, la clé RDS gérée par AWS s'applique."
  type        = string
  default     = ""
}

variable "iam_auth_role_names" {
  description = "Rôles IAM autorisés à se connecter par jeton (rds-db:connect)."
  type        = map(string)
  default     = {}
}

variable "iam_database_user" {
  description = "Rôle PostgreSQL porteur de rds_iam, cible des connexions par jeton."
  type        = string
  default     = "iam_app"
}

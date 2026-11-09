variable "project" {
  description = "Slug du projet — espace de noms des métriques applicatives."
  type        = string
}

variable "env" {
  description = "Environnement."
  type        = string
}

variable "names" {
  description = "Noms de ressources issus du module naming."
  type        = map(string)
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "retention_days" {
  description = "Rétention du groupe de journaux applicatif."
  type        = number
  default     = 30
}

variable "alert_emails" {
  description = "Destinataires des alarmes et du budget."
  type        = list(string)
  default     = []
}

variable "alert_webhook_url" {
  description = "URL de notification de la plateforme, abonnée au sujet SNS."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Budget mensuel en USD. 0 désactive le budget."
  type        = number
  default     = 0
}

variable "rds_identifier" {
  description = "Identifiant de l'instance RDS surveillée."
  type        = string
}

variable "rds_free_storage_threshold_bytes" {
  description = "Seuil d'espace libre déclenchant l'alarme, en octets. Environ 15% du stockage alloué."
  type        = number
  default     = 3221225472 # 3 Go
}

variable "rds_max_connections_threshold" {
  description = "Seuil de connexions ouvertes déclenchant l'alarme."
  type        = number
  default     = 80
}

variable "enable_cdn_alarms" {
  description = "Alarmes du bord. Sans CloudFront, elles porteraient sur une distribution inexistante."
  type        = bool
  default     = false
}

variable "cloudfront_distribution_id" {
  description = "Distribution surveillée par les alarmes du bord."
  type        = string
  default     = ""
}

variable "enable_etl_freshness_alert" {
  description = "Alarme « aucun ETL réussi depuis 5 jours »."
  type        = bool
  default     = true
}

variable "telemetry_role_names" {
  description = "Rôles IAM des charges de travail dont le sidecar OpenTelemetry exporte vers X-Ray et CloudWatch."
  type        = map(string)
  default     = {}
}

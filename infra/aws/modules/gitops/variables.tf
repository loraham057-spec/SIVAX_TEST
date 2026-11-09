variable "env" {
  description = "Environnement — détermine le chemin réconcilié (infra/k8s/flux/<env>)."
  type        = string
}

variable "repository_url" {
  description = "URL HTTPS du dépôt. Convertie en ssh:// quand une clé de déploiement est utilisée."
  type        = string
}

variable "branch" {
  description = "Branche réconciliée. Branche = environnement : un cluster ne réconcilie que la sienne, donc un déploiement poussé ailleurs ne peut pas l'atteindre."
  type        = string
}

variable "use_deploy_key" {
  description = "Engendrer une clé de déploiement ED25519 et l'utiliser pour cloner."
  type        = bool
  default     = true
}

variable "https_token" {
  description = "Jeton d'accès au dépôt. Fourni, il l'emporte sur la clé de déploiement — l'amorçage devient alors entièrement reproductible, sans geste manuel entre l'apply et un cluster qui réconcilie."
  type        = string
  default     = ""
  sensitive   = true
}

variable "substitutions" {
  description = "Valeurs propres à l'environnement, exposées aux Kustomization par postBuild.substituteFrom. Toutes non secrètes."
  type        = map(string)
  default     = {}
}

variable "secret_substitutions" {
  description = "Mêmes substitutions, pour les valeurs qui sont des secrets — exposées par un Secret plutôt qu'un ConfigMap."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "flux_chart_version" {
  description = "Version du chart flux2."
  type        = string
  default     = "2.14.1"
}

variable "flux_sync_chart_version" {
  description = "Version du chart flux2-sync."
  type        = string
  default     = "1.10.0"
}

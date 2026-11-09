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

variable "app_origin_host" {
  description = "Hôte de l'origine applicative — le nom public de l'ingress, ou son IP élastique."
  type        = string
}

variable "origin_protocol_policy" {
  description = "http-only tant que l'ingress ne porte pas de certificat pour ce nom ; https-only ensuite."
  type        = string
  default     = "http-only"
}

variable "assets_origin_domain" {
  description = "Nom de domaine régional du bucket d'actifs."
  type        = string
}

variable "assets_bucket" {
  description = "Nom du bucket d'actifs — la politique d'accès d'origine y est posée."
  type        = string
}

variable "assets_bucket_arn" {
  description = "ARN du bucket d'actifs."
  type        = string
}

variable "custom_domain" {
  description = "Nom public servi par la distribution. Vide, le domaine cloudfront.net par défaut est utilisé et aucun certificat n'est demandé."
  type        = string
  default     = ""
}

variable "wait_for_certificate" {
  description = "Attendre la validation DNS du certificat pendant l'apply. À laisser faux au premier apply, quand l'enregistrement de validation n'existe pas encore."
  type        = bool
  default     = false
}

variable "enable_waf" {
  description = "Poser un WAF devant la distribution."
  type        = bool
  default     = true
}

variable "waf_mode" {
  description = "Prevention bloque, Detection compte seulement — le temps de régler les règles sans gêner les développeurs."
  type        = string
  default     = "Prevention"

  validation {
    condition     = contains(["Prevention", "Detection"], var.waf_mode)
    error_message = "waf_mode doit valoir Prevention ou Detection."
  }
}

variable "rate_limit_per_5min" {
  description = "Requêtes autorisées par IP sur cinq minutes."
  type        = number
  default     = 2000
}

variable "price_class" {
  description = "Étendue géographique des points de présence. PriceClass_100 (Europe et Amérique du Nord) suffit et coûte le moins."
  type        = string
  default     = "PriceClass_100"
}

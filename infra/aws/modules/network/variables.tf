variable "region" {
  description = "Région AWS."
  type        = string
}

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

variable "cluster_name" {
  description = "Nom du cluster EKS — nécessaire pour taguer les sous-réseaux (kubernetes.io/cluster/<nom>), sans quoi le contrôleur de load balancer ne les retient pas."
  type        = string
}

variable "address_space" {
  description = "CIDR du VPC. Les sous-réseaux en sont dérivés : publics /20, privés /20, données /24."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.address_space, 8, 130))
    error_message = "address_space doit être un bloc CIDR de taille /16 ou plus large."
  }
}

variable "zone_redundant" {
  description = "Trois zones et une NAT Gateway par zone. Activé en prod, coupé en dev où une seule NAT suffit (chaque NAT coûte environ 35 USD par mois)."
  type        = bool
  default     = false
}

variable "create_ingress_eip" {
  description = "Pré-allouer les IP élastiques du NLB d'ingress, pour que l'origine CloudFront et le DNS soient câblés dès le premier apply."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "Points de terminaison d'interface pour ECR, Secrets Manager, CloudWatch et STS. Ferment la sortie vers Internet public pour ces appels, au prix d'environ 7 USD par mois et par zone."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "Journaliser les flux rejetés du VPC dans CloudWatch."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Rétention des journaux de flux."
  type        = number
  default     = 30
}

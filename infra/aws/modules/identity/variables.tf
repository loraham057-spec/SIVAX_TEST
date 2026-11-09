variable "names" {
  description = "Noms de ressources issus du module naming."
  type        = map(string)
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "oidc_provider_arn" {
  description = "ARN du fournisseur OIDC du cluster EKS."
  type        = string
}

variable "oidc_issuer_url" {
  description = "URL de l'émetteur OIDC du cluster."
  type        = string
}

variable "kubernetes_namespace" {
  description = "Namespace hébergeant les ServiceAccount fédérés."
  type        = string
  default     = "diav1"
}

variable "service_accounts" {
  description = "ServiceAccount → nom du rôle IAM. Les clés doivent correspondre aux ServiceAccount de k8s/base/serviceaccounts.yaml (web, ai, jobs)."
  type        = map(string)
}

variable "create_cicd_role" {
  description = "Créer le rôle assumé par le pipeline."
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "Fournisseur OIDC GitHub Actions du compte. Vide, le rôle du pipeline n'est assumable que par cicd_trusted_principal_arns."
  type        = string
  default     = ""
}

variable "github_subjects" {
  description = "Sujets OIDC autorisés, par exemple repo:org/depot:ref:refs/heads/dev."
  type        = list(string)
  default     = []
}

variable "cicd_trusted_principal_arns" {
  description = "Principaux IAM autorisés à assumer le rôle du pipeline — la voie d'entrée pour un orchestrateur autre que GitHub Actions."
  type        = list(string)
  default     = []
}

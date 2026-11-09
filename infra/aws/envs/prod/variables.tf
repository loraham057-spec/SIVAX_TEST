// Entrées communes à tous les environnements. Les valeurs non secrètes
// viennent de terraform.tfvars ; les secrets arrivent en TF_VAR_* depuis le
// magasin de secrets du pipeline et ne doivent jamais être écrits dans un
// fichier tfvars.

variable "project" {
  description = "Slug du projet."
  type        = string
  default     = "diav1"
}

variable "region" {
  description = "Région AWS."
  type        = string
  default     = "eu-west-3"
}

// Pas de variable image_tag ici : le tag déployé est fixé par la kustomization
// de l'overlay et réconcilié par Flux, jamais par Terraform. Terraform décrit
// la plateforme, pas la version qui y tourne.

variable "alert_emails" {
  description = "Destinataires des alarmes et du budget."
  type        = list(string)
  default     = []
}

// ─── Accès ────────────────────────────────────────────────

variable "eks_admin_principal_arns" {
  description = "Principaux IAM recevant l'accès administrateur au cluster."
  type        = list(string)
  default     = []
}

variable "eks_api_allowed_cidrs" {
  description = "Adresses autorisées sur le point de terminaison public de l'API."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "deployer_principal_arn" {
  description = "Rôle du pipeline. Vide, le principal qui exécute l'apply est utilisé."
  type        = string
  default     = ""
}

variable "create_cicd_role" {
  description = "Créer le rôle assumé par le pipeline."
  type        = bool
  default     = false
}

variable "github_oidc_provider_arn" {
  description = "Fournisseur OIDC GitHub Actions du compte."
  type        = string
  default     = ""
}

variable "github_subjects" {
  description = "Sujets OIDC autorisés, par exemple repo:org/depot:ref:refs/heads/dev."
  type        = list(string)
  default     = []
}

variable "cicd_trusted_principal_arns" {
  description = "Principaux IAM autorisés à assumer le rôle du pipeline."
  type        = list(string)
  default     = []
}

// ─── Bord ─────────────────────────────────────────────────

variable "enable_cdn" {
  description = "Provisionner CloudFront et le WAF."
  type        = bool
  default     = false
}

variable "ingress_hostname" {
  description = "Nom DNS pointant sur les IP d'ingress — origine du CDN."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Nom public de l'environnement."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "Adresse du compte ACME Let's Encrypt."
  type        = string
  default     = ""
}

// ─── Modèles de langage ───────────────────────────────────

variable "enable_bedrock" {
  description = "Autoriser l'invocation de modèles Bedrock."
  type        = bool
  default     = false
}

variable "bedrock_model_ids" {
  description = "Identifiants de modèles autorisés."
  type        = list(string)
  default     = []
}

// ─── Configuration applicative (non secrète) ──────────────

variable "dhis2_base_url" {
  description = "URL de base SNIS RDC."
  type        = string
  default     = ""
}

variable "dhis2_username" {
  description = "Utilisateur SNIS RDC."
  type        = string
  default     = ""
}

variable "dhis2_root_ou" {
  description = "Unité d'organisation nationale."
  type        = string
  default     = "ymGeqzoPhN3"
}

variable "supabase_url" {
  description = "URL du projet Supabase."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Clé anonyme Supabase. Publique par nature."
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "Clé publique de notification web. Publique par nature."
  type        = string
  default     = ""
}

// ─── Secrets (TF_VAR_*) ───────────────────────────────────

variable "openai_api_key" {
  description = "Clé OpenAI."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dhis2_password" {
  description = "Mot de passe SNIS RDC."
  type        = string
  default     = ""
  sensitive   = true
}

variable "resend_api_key" {
  description = "Clé Resend."
  type        = string
  default     = ""
  sensitive   = true
}

variable "elevenlabs_api_key" {
  description = "Clé ElevenLabs."
  type        = string
  default     = ""
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Clé de service Supabase."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vapid_private_key" {
  description = "Clé privée de notification web."
  type        = string
  default     = ""
  sensitive   = true
}

variable "gitops_https_token" {
  description = "Jeton d'accès au dépôt pour Flux, alternative à la clé de déploiement."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_guardduty" {
  description = "Activer GuardDuty sur le compte."
  type        = bool
  default     = false
}

variable "enable_security_hub" {
  description = "Activer Security Hub sur le compte."
  type        = bool
  default     = false
}

variable "ingress_lb_hostname" {
  description = "Nom DNS du load balancer de l'ingress, origine du CDN. Vide = on passe par ingress_hostname."
  type        = string
  default     = ""
}

variable "restrict_ingress_to_cdn" {
  description = "Ne laisser atteindre l'ingress que par CloudFront. A laisser a false pendant la bascule DNS."
  type        = bool
  default     = true
}

variable "cdn_wait_for_certificate" {
  description = "Attendre la validation du certificat ACM pendant l'apply. Faux tant que les enregistrements de validation ne sont pas poses."
  type        = bool
  default     = true
}

variable "origin_protocol_policy" {
  description = "Comment CloudFront joint l'origine : http-only tant que l'ingress ne porte pas de certificat valide pour le nom vise, https-only ensuite."
  type        = string
  default     = "https-only"
}

variable "enable_edge_alb" {
  description = "Poser un ALB avec certificat ACM devant l'ingress."
  type        = bool
  default     = true
}

variable "extra_domain_names" {
  description = "Noms supplementaires servis par le meme bord."
  type        = list(string)
  default     = []
}

variable "edge_wait_for_certificate" {
  description = "Attendre la validation ACM pendant l'apply."
  type        = bool
  default     = false
}

variable "canonical_host" {
  description = "Nom que l'application annonce dans ses URL absolues. Vide, custom_domain fait foi."
  type        = string
  default     = ""
}

variable "enable_cicd" {
  description = "Provisionner la chaine de livraison CodeBuild de cet environnement."
  type        = bool
  default     = true
}

variable "create_github_oidc_provider" {
  description = "Creer le fournisseur OIDC GitHub Actions du compte. Un seul pour tout le compte."
  type        = bool
  default     = false
}

variable "cicd_enable_codebuild" {
  description = "Provisionner le projet CodeBuild. Faux tant que le compte refuse d'executer un build."
  type        = bool
  default     = false
}

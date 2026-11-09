variable "name_prefix" {
  description = "Prefixe <projet>-<env>."
  type        = string
}

variable "env" {
  description = "Nom de l'environnement — il designe l'overlay dont le tag est deplace."
  type        = string
}

variable "region" {
  description = "Region AWS."
  type        = string
}

variable "tags" {
  description = "Tags appliques a chaque ressource."
  type        = map(string)
}

variable "repository_url" {
  description = "URL HTTPS du depot GitHub."
  type        = string
}

variable "branch" {
  description = "Branche surveillee. Branche = environnement : ce projet ne construit que celle-ci."
  type        = string
}

variable "github_token" {
  description = "Jeton GitHub : il sert a cloner et a repousser le commit de tag."
  type        = string
  sensitive   = true
}

variable "manage_source_credential" {
  description = <<-DESC
    Declarer l'identifiant GitHub de CodeBuild dans cette region.

    La ressource est REGIONALE et de portee COMPTE : un seul identifiant GitHub
    par region, partage par tous les projets. Deux environnements dans la meme
    region se la disputeraient, et le second apply ecraserait le premier sans
    le dire. A laisser a true tant qu'un seul environnement occupe la region.
  DESC
  type        = bool
  default     = true
}

variable "enable_webhook" {
  description = "Poser le webhook GitHub qui declenche le build a chaque push. Faux pour un projet declenche a la main."
  type        = bool
  default     = true
}

variable "repository_urls" {
  description = "URL des depots ECR, indexees par image."
  type        = map(string)
}

variable "repository_arns" {
  description = "ARN des memes depots — ils bornent le droit de poussee."
  type        = map(string)
}

variable "secret_prefix" {
  description = "Prefixe des secrets de l'environnement."
  type        = string
}

variable "secret_recovery_window_days" {
  description = "Fenetre de recuperation du secret portant le jeton. Zero sur un environnement jetable, sinon le nom reste reserve et l'apply suivant echoue."
  type        = number
  default     = 7
}

variable "log_retention_days" {
  description = "Retention des journaux de build."
  type        = number
  default     = 30
}

variable "build_timeout" {
  description = "Minutes avant abandon d'un build. Les barrieres de qualite et deux images tiennent largement dedans."
  type        = number
  default     = 60
}

variable "compute_type" {
  description = "Taille de l'instance de build."
  type        = string
  default     = "BUILD_GENERAL1_MEDIUM"
}

variable "alerts_topic_arn" {
  description = "Sujet SNS recevant les echecs de build. Vide, aucune notification — un build qui echoue en silence est un deploiement qu'on croit parti."
  type        = string
  default     = ""
}

variable "supabase_url" {
  description = "URL Supabase compilee dans le bundle client."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Cle anonyme Supabase — publique par conception."
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "Cle publique Web Push — publique par conception."
  type        = string
  default     = ""
}

# ─── Choix du moteur ───────────────────────────────────────

variable "enable_codebuild" {
  description = <<-DESC
    Provisionner le projet CodeBuild.

    Faux par defaut : ce compte cree les projets mais refuse d'en executer un
    seul (« AccountLimitExceededException: Cannot have more than 0 builds in
    queue for the account »). Laisser le projet en place sans pouvoir le lancer
    donnerait un pipeline qui a l'air installe et ne part jamais — la pire des
    deux situations. A repasser a true quand le compte sera verifie.
  DESC
  type        = bool
  default     = false
}

variable "enable_github_actions" {
  description = "Provisionner ce dont le workflow GitHub Actions a besoin : le parametre de build et le droit de le lire."
  type        = bool
  default     = true
}



variable "cicd_role_name" {
  description = "Nom du role assume par le workflow. Vide, aucune politique de lecture n'est attachee."
  type        = string
  default     = ""
}

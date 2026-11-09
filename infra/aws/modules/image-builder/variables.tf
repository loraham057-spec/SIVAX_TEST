variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "unique_suffix" {
  description = "Suffixe déterministe — le nom du bucket de source est unique mondialement."
  type        = string
}

variable "region" {
  description = "Région AWS."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "repository_urls" {
  description = "URL des dépôts ECR, indexées par image (web, ai)."
  type        = map(string)
}

variable "repository_arns" {
  description = "ARN des mêmes dépôts — c'est ce qui borne le droit de push."
  type        = map(string)
}

variable "source_key" {
  description = "Clé de l'archive de source dans le bucket. L'archive est déposée hors Terraform (scripts/aws-build-images.sh)."
  type        = string
  default     = "source.zip"
}

variable "compute_type" {
  description = "Taille de l'instance de build. BUILD_GENERAL1_MEDIUM tient le build Next.js sans le faire durer."
  type        = string
  default     = "BUILD_GENERAL1_MEDIUM"
}

variable "log_retention_days" {
  description = "Rétention des journaux de build."
  type        = number
  default     = 30
}

variable "force_destroy" {
  description = "Vider le bucket de source à la destruction. Vrai sur un environnement jetable."
  type        = bool
  default     = false
}

variable "supabase_url" {
  description = "URL Supabase compilée dans le bundle client."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Clé anonyme Supabase — publique par conception, elle part dans le navigateur."
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "Clé publique Web Push — publique par conception."
  type        = string
  default     = ""
}

# ─── Construction dans le cluster ──────────────────────────

variable "enable_in_cluster_builder" {
  description = <<-DESC
    Creer le role IRSA qui permet de construire dans le cluster.

    Un interrupteur BOOLEEN, et non un test sur oidc_provider_arn : l'ARN du
    fournisseur OIDC n'existe pas avant que le cluster soit cree, donc un
    `count` qui en depend est inconnu au plan et Terraform refuse le plan
    entier (« The count value depends on resource attributes that cannot be
    determined until apply »). Le defaut ne se voyait pas sur un environnement
    deja applique, et arretait net la creation d'un environnement neuf.
  DESC
  type        = bool
  default     = true
}

variable "oidc_provider_arn" {
  description = "Fournisseur OIDC du cluster, consomme par la politique de confiance du rôle."
  type        = string
  default     = ""
}

variable "oidc_issuer_url" {
  description = "URL de l'émetteur OIDC du cluster, sans le schéma — elle forme la condition `sub`."
  type        = string
  default     = ""
}

variable "builder_namespace" {
  description = <<-DESC
    Namespace du Job de construction. DELIBEREMENT DISTINCT du namespace
    applicatif : celui-ci applique PodSecurity « restricted », et Kaniko a
    besoin d'ecrire dans le systeme de fichiers du conteneur en root. Le Job y
    est refuse a la creation, en boucle et sans qu'aucun pod n'apparaisse.

    Assouplir la politique du namespace applicatif pour un outil d'amorcage
    serait le mauvais arbitrage : c'est l'outil qui va ailleurs, pas
    l'application qui baisse sa garde.
  DESC
  type        = string
  default     = "image-build"
}

variable "builder_service_account" {
  description = "ServiceAccount porté par le Job de construction."
  type        = string
  default     = "image-builder"
}

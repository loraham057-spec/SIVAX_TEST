/**
 * Environnement dev.
 *
 * Dimensionné pour être bon marché et jetable : c'est l'environnement dont les
 * critères d'acceptation disent qu'il doit survivre à un `terraform destroy`
 * suivi d'un `terraform apply` en moins de 45 minutes, sans geste manuel.
 *
 * Trois réglages servent précisément cette propriété et méritent d'être lus
 * ensemble : `secret_recovery_window_days = 0` (sinon le nom d'un secret reste
 * réservé sept jours et l'apply suivant échoue), `s3_force_destroy` et
 * `ecr_force_delete` (sinon un bucket ou un dépôt non vide bloque la
 * destruction), `postgres_skip_final_snapshot` (sinon chaque destruction laisse
 * un instantané facturé).
 */

module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project      = var.project
  env          = "dev"
  region       = var.region
  alert_emails = var.alert_emails

  # ─── Exécution : Kubernetes managé ───
  kubernetes_version = "1.31"
  # dev garde un serveur d'API public, pour que kubectl fonctionne sans rebond.
  eks_private_cluster   = false
  eks_api_allowed_cidrs = var.eks_api_allowed_cidrs

  # Un seul groupe de nœuds, non souillé : les pods applicatifs y vont aussi.
  # Deux t3a.medium suffisent à la pile mesurée (l'application demande environ
  # 600 mCPU) une fois Container Insights coupé.
  eks_system_node_instance_type  = "t3a.medium"
  eks_system_autoscaling_enabled = false
  eks_system_node_count          = 2
  eks_system_pool_dedicated      = false
  eks_enable_user_pool           = false

  # Mesuré côté Azure et vrai ici aussi : l'agent d'observabilité réserve
  # nettement plus que l'application elle-même sur un cluster de cette taille.
  # Les traces applicatives passent de toute façon par les sidecars
  # OpenTelemetry.
  enable_container_insights = false

  eks_admin_principal_arns = var.eks_admin_principal_arns
  deployer_principal_arn   = var.deployer_principal_arn

  # Branche = environnement : ce cluster ne réconcilie que la branche « dev »,
  # donc un déploiement poussé ailleurs ne peut pas l'atteindre.
  gitops_branch = "dev"
  # Dépôt privé : Flux ne peut pas cloner sans identifiants.
  gitops_use_deploy_key = true
  gitops_https_token    = var.gitops_https_token

  # ─── Chaine de livraison ───
  enable_cicd                 = var.enable_cicd
  create_github_oidc_provider = var.create_github_oidc_provider
  cicd_enable_codebuild       = var.cicd_enable_codebuild

  # ─── Réseau ───
  address_space              = "10.20.0.0/16"
  zone_redundant             = false
  enable_interface_endpoints = false # deux points de terminaison par service et par zone, pour un environnement jetable

  # ─── Données : les plus petits paliers qui exercent quand même le vrai service ───
  postgres_instance_class        = "db.t4g.micro"
  postgres_allocated_storage     = 20
  postgres_max_allocated_storage = 100
  postgres_backup_retention_days = 7
  postgres_multi_az              = false
  postgres_deletion_protection   = false
  postgres_skip_final_snapshot   = true

  enable_managed_redis = false # Redis tourne dans le cluster

  # ─── Reconstructibilité ───
  secret_recovery_window_days = 0
  s3_force_destroy            = true
  ecr_force_delete            = true
  create_kms_key              = false

  # ─── Bord ───
  # Sans CDN, l'IP d'ingress est le point d'entrée et le groupe de sécurité
  # s'ouvre sur 80/443. Passer enable_cdn à true suppose que ingress_hostname
  # pointe déjà, par un enregistrement A, sur les IP d'ingress.
  enable_cdn                 = var.enable_cdn
  ingress_hostname           = var.ingress_hostname
  ingress_lb_hostname        = var.ingress_lb_hostname
  restrict_ingress_to_cdn    = var.restrict_ingress_to_cdn
  cdn_wait_for_certificate   = var.cdn_wait_for_certificate
  cdn_origin_protocol_policy = var.origin_protocol_policy

  # ─── Bord : ALB + certificat ACM ───
  enable_edge_alb           = var.enable_edge_alb
  extra_domain_names        = var.extra_domain_names
  edge_wait_for_certificate = var.edge_wait_for_certificate
  custom_domain             = var.custom_domain
  canonical_host            = var.canonical_host
  waf_mode                  = "Detection" # journaliser pendant le réglage, ne pas bloquer les développeurs
  acme_email                = var.acme_email

  # ─── Observabilité ───
  log_retention_days = 30
  monthly_budget_usd = 250

  # ─── Gouvernance : allégée pour que l'environnement se reconstruise librement ───
  enforce_policies       = false
  enable_guardduty       = false
  enable_security_hub    = false
  enable_access_analyzer = true

  # ─── Modèles de langage ───
  # L'application utilise l'API OpenAI publique par le secret openai-api-key.
  # Passer enable_bedrock à true déplace l'inférence sur Bedrock — l'accès aux
  # modèles doit d'abord être demandé dans la console du compte.
  enable_bedrock    = var.enable_bedrock
  bedrock_model_ids = var.bedrock_model_ids

  # ─── Pipeline ───
  create_cicd_role            = var.create_cicd_role
  github_oidc_provider_arn    = var.github_oidc_provider_arn
  github_subjects             = var.github_subjects
  cicd_trusted_principal_arns = var.cicd_trusted_principal_arns

  # ─── Configuration applicative ───
  dhis2_base_url    = var.dhis2_base_url
  dhis2_username    = var.dhis2_username
  dhis2_root_ou     = var.dhis2_root_ou
  supabase_url      = var.supabase_url
  supabase_anon_key = var.supabase_anon_key
  vapid_public_key  = var.vapid_public_key

  # ─── Secrets, depuis le magasin de secrets du pipeline ───
  openai_api_key            = var.openai_api_key
  dhis2_password            = var.dhis2_password
  resend_api_key            = var.resend_api_key
  elevenlabs_api_key        = var.elevenlabs_api_key
  supabase_service_role_key = var.supabase_service_role_key
  vapid_private_key         = var.vapid_private_key
}

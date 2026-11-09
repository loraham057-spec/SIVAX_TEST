/**
 * Environnement prod — « prod-lite » sous contrainte de budget.
 *
 * Tenu sous un plafond de l'ordre de 800 USD par mois pour dev et prod
 * réunis, ce qui impose des renoncements délibérés par rapport à une pile de
 * production complète : nœuds burstables, pas de Multi-AZ sur la base, pas de
 * réplique ElastiCache, détection limitée. Chacun est une ligne ci-dessous, si
 * bien que restaurer une vraie production est un changement de dimensionnement,
 * pas une refonte.
 *
 * Ce que prod ne partage PAS avec dev, et qui n'est pas négociable :
 *   · une fenêtre de récupération des secrets non nulle ;
 *   · la protection contre la suppression de la base et un instantané final ;
 *   · un bucket et un registre qui refusent d'être détruits pleins ;
 *   · un serveur d'API dont la liste d'adresses autorisées est tenue à jour.
 *
 * L'approbation de déploiement (un relecteur obligatoire sur l'environnement
 * du pipeline) reste ce qui sépare une fusion d'un changement en production.
 */

module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project      = var.project
  env          = "prod"
  region       = var.region
  alert_emails = var.alert_emails

  data_classification = "confidential"

  # ─── Exécution : Kubernetes managé ───
  kubernetes_version = "1.31"

  # Point de terminaison PUBLIC MAIS RESTREINT, et non prive, et c'est une
  # decision, pas un relachement. EKS n'a pas d'equivalent d'`az aks command
  # invoke` : avec un serveur d'API prive, ni Terraform (qui installe Flux par
  # les fournisseurs helm/kubernetes) ni le pipeline de deploiement ne peuvent
  # l'atteindre depuis l'exterieur du VPC. Un cluster reellement prive impose
  # donc un agent auto-heberge dans le VPC — c'est le pas suivant, et il est
  # documente dans .azuredevops/README.md.
  #
  # En attendant, la surface est reduite par la liste d'adresses autorisees
  # (eks_api_allowed_cidrs, tfvars) plutot que par l'absence d'adresse. Toute
  # requete reste par ailleurs authentifiee par IAM et autorisee par une entree
  # d'acces EKS : la liste est une deuxieme barriere, pas la seule.
  eks_private_cluster = false

  # Groupe système souillé : les add-ons d'un côté, l'application de l'autre,
  # pour qu'une charge emballée ne prive pas CoreDNS de CPU.
  eks_system_node_instance_type  = "t3a.medium"
  eks_system_autoscaling_enabled = false
  eks_system_node_count          = 2
  eks_system_pool_dedicated      = true

  # Groupe applicatif autoscalé : web, ai, leurs sidecars, les jobs ETL.
  eks_enable_user_pool = true
  # t3a.medium et non large : mesure faite sur le cluster, les pods applicatifs
  # demandent 610 mCPU au total. Deux t3a.large offraient 4 vCPU pour ce
  # besoin — quatre fois trop — a 126 USD par mois. Deux t3a.medium laissent
  # encore trois fois la marge necessaire, conservent la haute disponibilite
  # (deux noeuds) et l'isolation d'avec le pool systeme, pour moitie prix.
  eks_user_node_instance_type  = "t3a.medium"
  eks_user_node_capacity_type  = "ON_DEMAND" # pas de reprise d'instance sur le chemin utilisateur
  eks_user_autoscaling_enabled = true
  eks_user_node_min_count      = 2
  eks_user_node_max_count      = 4

  enable_container_insights = false

  eks_admin_principal_arns = var.eks_admin_principal_arns
  deployer_principal_arn   = var.deployer_principal_arn

  # Branche = environnement : ce cluster ne réconcilie que « prod ».
  gitops_branch = "prod"
  # Dépôt privé : sans identifiants, Flux ne clone pas et le cluster reste vide
  # — infrastructure saine, mais sans application.
  gitops_use_deploy_key = true
  gitops_https_token    = var.gitops_https_token

  # ─── Chaine de livraison ───
  enable_cicd                 = var.enable_cicd
  create_github_oidc_provider = var.create_github_oidc_provider
  cicd_enable_codebuild       = var.cicd_enable_codebuild

  # ─── Réseau ───
  address_space  = "10.40.0.0/16"
  zone_redundant = true # trois zones, une NAT par zone
  # Ferme la dernière voie par laquelle un appel à Secrets Manager ou à ECR
  # sortirait sur Internet public.
  enable_interface_endpoints = true

  # ─── Données ───
  postgres_instance_class        = "db.t4g.small"
  postgres_allocated_storage     = 50
  postgres_max_allocated_storage = 200
  postgres_backup_retention_days = 14
  postgres_multi_az              = false # concession de budget : à passer à true dès que le SLA le justifie
  postgres_deletion_protection   = true
  postgres_skip_final_snapshot   = false

  enable_managed_redis = false # Redis tourne dans le cluster, comme en dev

  # ─── Sûreté ───
  secret_recovery_window_days = 7
  s3_force_destroy            = false
  ecr_force_delete            = false
  create_kms_key              = true

  # ─── Bord ───
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
  enable_waf                = true
  waf_mode                  = "Prevention"
  acme_email                = var.acme_email

  # ─── Observabilité ───
  log_retention_days = 90
  monthly_budget_usd = 500

  # ─── Gouvernance ───
  enforce_policies       = true
  enable_guardduty       = var.enable_guardduty
  enable_security_hub    = var.enable_security_hub
  enable_access_analyzer = true

  # ─── Modèles de langage ───
  enable_bedrock             = var.enable_bedrock
  bedrock_model_ids          = var.bedrock_model_ids
  bedrock_invocation_logging = var.enable_bedrock

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

  # ─── Secrets ───
  openai_api_key            = var.openai_api_key
  dhis2_password            = var.dhis2_password
  resend_api_key            = var.resend_api_key
  elevenlabs_api_key        = var.elevenlabs_api_key
  supabase_service_role_key = var.supabase_service_role_key
  vapid_private_key         = var.vapid_private_key
}

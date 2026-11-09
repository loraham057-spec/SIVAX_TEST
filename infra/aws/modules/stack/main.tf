/**
 * Module stack — compose toute la plateforme pour un environnement.
 *
 * Chaque répertoire d'environnement est une enveloppe mince autour de ce
 * module, avec son propre état et ses propres tfvars. On garde ainsi la
 * propriété que la feuille de route demande : le MÊME code Terraform pour dev,
 * staging et prod, seuls le dimensionnement et les interrupteurs de sûreté
 * changeant — tout en conservant un état par environnement, pour qu'une erreur
 * ne puisse pas franchir la frontière de celui où elle a été faite.
 *
 * Créer un quatrième environnement, c'est un répertoire et un fichier tfvars.
 *
 * ─── Ordre de composition ───
 * Le cluster précède les identités, contrairement à Azure : sur AWS, un rôle
 * IRSA n'existe pas sans le fournisseur OIDC du cluster, qui n'existe pas sans
 * le cluster. Les politiques d'accès (S3, secrets, ECR, Bedrock) sont ensuite
 * attachées à ces rôles par chaque module de service, pour que la lecture d'un
 * module dise tout ce qu'il autorise.
 */

data "aws_caller_identity" "current" {}

# ─── Noms et tags ──────────────────────────────────────────

module "naming" {
  source = "../naming"

  project             = var.project
  env                 = var.env
  region              = var.region
  account_id          = data.aws_caller_identity.current.account_id
  owner               = var.owner
  cost_center         = var.cost_center
  data_classification = var.data_classification
}

# ─── Réseau ────────────────────────────────────────────────

module "network" {
  source = "../network"

  region      = var.region
  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  # Les sous-réseaux doivent porter le tag du cluster avant que le cluster
  # existe : le contrôleur de load balancer les cherche par ce tag.
  cluster_name = module.naming.names.eks

  address_space  = var.address_space
  zone_redundant = var.zone_redundant

  # Adresses d'entrée pré-allouées. Elles servaient à ce que le NLB adopte des
  # adresses fixes, connues dès le plan. Le compte refusant les NLB, le bord est
  # un ALB — qui gère ses propres adresses — et ces IP ne sont plus associées à
  # rien. AWS facture toute adresse IPv4 publique depuis février 2024, réservée
  # ou en service : une adresse orpheline coûte exactement le prix d'une adresse
  # qui travaille. D'où le défaut à false.
  create_ingress_eip         = var.create_ingress_eip
  enable_interface_endpoints = var.enable_interface_endpoints
  enable_flow_logs           = var.enable_flow_logs
  log_retention_days         = var.log_retention_days
}

# ─── Exécution ─────────────────────────────────────────────

module "runtime_eks" {
  source = "../runtime-eks"

  region      = var.region
  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  private_subnet_ids = module.network.private_subnet_ids
  vpc_cidr           = module.network.vpc_cidr

  kubernetes_version      = var.kubernetes_version
  private_cluster_enabled = var.eks_private_cluster
  api_allowed_cidrs       = var.eks_api_allowed_cidrs
  log_retention_days      = var.log_retention_days
  secrets_kms_key_arn     = module.secrets.kms_key_arn

  system_node_instance_type  = var.eks_system_node_instance_type
  system_node_count          = var.eks_system_node_count
  system_autoscaling_enabled = var.eks_system_autoscaling_enabled
  system_node_min_count      = var.eks_system_node_min_count
  system_node_max_count      = var.eks_system_node_max_count
  system_pool_dedicated      = var.eks_system_pool_dedicated

  enable_user_pool         = var.eks_enable_user_pool
  user_node_instance_type  = var.eks_user_node_instance_type
  user_node_capacity_type  = var.eks_user_node_capacity_type
  user_node_count          = var.eks_user_node_count
  user_autoscaling_enabled = var.eks_user_autoscaling_enabled
  user_node_min_count      = var.eks_user_node_min_count
  user_node_max_count      = var.eks_user_node_max_count

  admin_principal_arns = var.eks_admin_principal_arns
  # Vide = aucune entree d'acces creee pour le deployeur, et c'est le bon
  # defaut : EKS accorde deja l'administration du cluster au principal QUI LE
  # CREE (bootstrapClusterCreatorAdminPermissions), sous la forme d'une entree
  # d'acces qu'il gere lui-meme. En creer une seconde pour le meme principal
  # echoue en ResourceInUseException et fait echouer tout l'apply.
  #
  # A renseigner quand le pipeline s'authentifie sous un principal DIFFERENT de
  # celui qui a cree le cluster — le cas normal en CI.
  deployer_principal_arn = var.deployer_principal_arn

  # Sans CDN, l'ingress est le seul chemin d'entrée et doit rester ouvert :
  # restreindre à la liste de préfixes CloudFront ferait alors tomber tout le
  # trafic légitime, cluster sain et pas une requête qui arrive.
  # Deux interrupteurs plutot qu'un, parce que la bascule se fait en deux
  # temps : la distribution existe et sert avant que le DNS public ne pointe
  # dessus. Restreindre l'origine des la creation du CDN couperait le seul
  # chemin encore emprunte — celui du load balancer — pendant tout l'entre-deux,
  # y compris pour la validation ACME.
  restrict_ingress_to_cdn   = var.enable_cdn && var.restrict_ingress_to_cdn
  enable_container_insights = var.enable_container_insights
}

# ─── Fédération GitHub Actions ─────────────────────────────
#
# Ce que ce fournisseur remplace : une paire de cles AWS deposee dans les
# secrets du depot. Le workflow presente un jeton signe par GitHub, AWS verifie
# qu'il vient bien de CE depot et de CETTE branche, puis delivre des
# identifiants temporaires. Rien a poser, rien a faire tourner, rien a revoquer
# quand quelqu'un quitte l'equipe.
#
# Ressource de portee COMPTE : un seul pour toutes les regions. Le second
# environnement recoit son ARN au lieu d'en creer un deuxieme, ce qui echouerait
# en EntityAlreadyExists et arreterait l'apply.

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS verifie desormais lui-meme la chaine de certification, mais l'API exige
  # toujours ce champ.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
  tags            = module.naming.tags
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
}

# ─── Identités ─────────────────────────────────────────────

module "identity" {
  source = "../identity"

  names = module.naming.names
  tags  = module.naming.tags

  oidc_provider_arn    = module.runtime_eks.oidc_provider_arn
  oidc_issuer_url      = module.runtime_eks.oidc_issuer_url
  kubernetes_namespace = var.kubernetes_namespace

  # Les CLÉS doivent correspondre aux ServiceAccount de
  # k8s/base/serviceaccounts.yaml : elles forment la condition `sub` de la
  # politique de confiance.
  service_accounts = {
    web  = module.naming.names.role_web
    ai   = module.naming.names.role_ai
    jobs = module.naming.names.role_jobs
  }

  create_cicd_role            = var.create_cicd_role
  github_oidc_provider_arn    = local.github_oidc_provider_arn
  github_subjects             = var.github_subjects
  cicd_trusted_principal_arns = var.cicd_trusted_principal_arns
}

# ─── Registre ──────────────────────────────────────────────

module "ecr" {
  source = "../ecr"

  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  force_delete    = var.ecr_force_delete
  push_role_names = compact([module.identity.cicd_role_name])
}

# ─── Construction des images ───────────────────────────────
#
# Le pipeline reste le chemin normal ; ce module existe pour que monter un
# environnement neuf ne dépende ni d'un poste de travail ni d'une organisation
# CI déjà configurée. Voir modules/image-builder pour le raisonnement.

module "image_builder" {
  count  = var.enable_image_builder ? 1 : 0
  source = "../image-builder"

  name_prefix   = module.naming.name_prefix
  unique_suffix = module.naming.unique_suffix
  region        = var.region
  tags          = module.naming.tags

  repository_urls = module.ecr.repository_urls
  repository_arns = module.ecr.repository_arns

  log_retention_days = var.log_retention_days
  force_destroy      = var.s3_force_destroy

  supabase_url      = var.supabase_url
  supabase_anon_key = var.supabase_anon_key
  vapid_public_key  = var.vapid_public_key

  # Permet de construire DANS le cluster quand CodeBuild n'est pas utilisable.
  oidc_provider_arn = module.runtime_eks.oidc_provider_arn
  oidc_issuer_url   = replace(module.runtime_eks.oidc_issuer_url, "https://", "")
  # Pas var.kubernetes_namespace : voir le commentaire de builder_namespace.
}

# ─── Chaîne de livraison ───────────────────────────────────
#
# CodeBuild déclenché par webhook GitHub. Voir l'en-tête du module pour le
# raisonnement — notamment pourquoi CodePipeline est écarté (sa connexion
# GitHub exige un clic dans la console, donc l'environnement cesse d'être
# reconstructible par un seul apply).

module "cicd" {
  count  = var.enable_cicd ? 1 : 0
  source = "../cicd"

  name_prefix = module.naming.name_prefix
  env         = var.env
  region      = var.region
  tags        = module.naming.tags

  repository_url = var.gitops_repository_url
  # Branche = environnement, la même règle que Flux : ce projet ne construit
  # que la branche que CE cluster réconcilie.
  branch       = var.gitops_branch
  github_token = var.gitops_https_token

  manage_source_credential = var.cicd_manage_source_credential
  enable_webhook           = var.cicd_enable_webhook

  repository_urls = module.ecr.repository_urls
  repository_arns = module.ecr.repository_arns

  secret_prefix               = module.naming.names.secret_prefix
  secret_recovery_window_days = var.secret_recovery_window_days
  log_retention_days          = var.log_retention_days
  alerts_topic_arn            = module.observability.sns_topic_arn

  supabase_url      = var.supabase_url
  supabase_anon_key = var.supabase_anon_key
  vapid_public_key  = var.vapid_public_key

  enable_codebuild      = var.cicd_enable_codebuild
  enable_github_actions = var.cicd_enable_github_actions
  cicd_role_name        = module.identity.cicd_role_name
}

# ─── Actifs statiques ──────────────────────────────────────

module "s3_assets" {
  source = "../s3-assets"

  names = module.naming.names
  tags  = module.naming.tags

  force_destroy = var.s3_force_destroy
  # Sans CDN devant, un bucket entièrement privé rendrait illisibles les URL
  # que l'application publie. Le préfixe assets/ s'ouvre alors en lecture
  # anonyme, et lui seul.
  assets_public_read = !var.enable_cdn

  contributor_role_names = {
    jobs = module.identity.role_names["jobs"]
    web  = module.identity.role_names["web"]
  }
  reader_role_names = {
    ai = module.identity.role_names["ai"]
  }
}

# ─── Secrets ───────────────────────────────────────────────

module "secrets" {
  source = "../secrets"

  secret_prefix = module.naming.names.secret_prefix
  name_prefix   = module.naming.name_prefix
  tags          = module.naming.tags

  recovery_window_days = var.secret_recovery_window_days
  create_kms_key       = var.create_kms_key

  reader_role_names = {
    web  = module.identity.role_names["web"]
    ai   = module.identity.role_names["ai"]
    jobs = module.identity.role_names["jobs"]
  }

  # Valeurs tierces, arrivées par TF_VAR_* depuis le magasin de secrets du
  # pipeline. Les chaînes de connexion sont composées ici, de sorte qu'aucun
  # humain ne les manipule.
  secrets = {
    "openai-api-key"            = var.openai_api_key
    "dhis2-password"            = var.dhis2_password
    "resend-api-key"            = var.resend_api_key
    "elevenlabs-api-key"        = var.elevenlabs_api_key
    "supabase-service-role-key" = var.supabase_service_role_key
    "vapid-private-key"         = var.vapid_private_key
  }

  # Composées à partir d'autres ressources — inconnues au plan.
  computed_secrets = {
    "redis-url"    = local.redis_connection_string
    "database-url" = module.rds.connection_string
  }
}

# ─── Base de données ───────────────────────────────────────

module "rds" {
  source = "../rds"

  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags
  region      = var.region
  account_id  = data.aws_caller_identity.current.account_id

  subnet_ids         = module.network.database_subnet_ids
  security_group_ids = [module.network.data_security_group_id]

  engine_version        = var.postgres_version
  instance_class        = var.postgres_instance_class
  allocated_storage     = var.postgres_allocated_storage
  max_allocated_storage = var.postgres_max_allocated_storage
  database_name         = module.naming.names.database

  administrator_password = module.secrets.postgres_admin_password

  multi_az              = var.postgres_multi_az
  backup_retention_days = var.postgres_backup_retention_days
  deletion_protection   = var.postgres_deletion_protection
  skip_final_snapshot   = var.postgres_skip_final_snapshot
  kms_key_arn           = module.secrets.kms_key_arn

  iam_auth_role_names = {
    jobs = module.identity.role_names["jobs"]
    web  = module.identity.role_names["web"]
  }
}

# ElastiCache est facultatif, et le défaut est de s'en passer. Redis tourne
# alors DANS le cluster (infra/k8s/base/redis.yaml) : un petit pod, aucune
# ressource AWS, aucun coût. C'est un compromis défendable en dev comme sur une
# production sous contrainte de budget — le cache ne porte que des métadonnées
# DHIS2, des résultats d'analytics et des compteurs de débit, tous
# reconstructibles, et la couche de cache de l'application retombe déjà sur la
# mémoire du processus quand Redis est injoignable.
#
# Passer enable_managed_redis à true quand la durabilité et un SLA justifient
# la dépense.
module "elasticache" {
  count  = var.enable_managed_redis ? 1 : 0
  source = "../elasticache"

  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  subnet_ids         = module.network.database_subnet_ids
  security_group_ids = [module.network.data_security_group_id]

  node_type          = var.redis_node_type
  replica_count      = var.redis_replica_count
  log_retention_days = var.log_retention_days
}

locals {
  # Redis en cluster est joint par le réseau du cluster ; sans mot de passe,
  # parce que la NetworkPolicy restreint déjà qui peut ouvrir une connexion.
  redis_connection_string = (
    var.enable_managed_redis
    ? module.elasticache[0].connection_string
    : "redis://redis.${var.kubernetes_namespace}.svc.cluster.local:6379"
  )
}

# ─── Modèles de langage ────────────────────────────────────

module "bedrock" {
  count  = var.enable_bedrock ? 1 : 0
  source = "../bedrock"

  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  model_ids = var.bedrock_model_ids
  user_role_names = {
    ai   = module.identity.role_names["ai"]
    jobs = module.identity.role_names["jobs"]
  }

  enable_invocation_logging = var.bedrock_invocation_logging
  log_retention_days        = var.log_retention_days
}

# ─── Bord : ALB + ACM ──────────────────────────────────────
#
# Le point d'entree public. Il remplace le couple NLB + CloudFront prevu a
# l'origine, que ce compte AWS refuse tous les deux — voir l'en-tete du module
# edge-alb, qui porte le detail et la verification.

module "edge" {
  count  = var.enable_edge_alb ? 1 : 0
  source = "../edge-alb"

  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  vpc_id            = module.network.vpc_id
  vpc_cidr          = module.network.vpc_cidr
  public_subnet_ids = module.network.public_subnet_ids

  node_security_group_id  = module.runtime_eks.cluster_security_group_id
  node_autoscaling_groups = module.runtime_eks.node_autoscaling_groups

  ingress_http_node_port  = var.ingress_http_node_port
  ingress_https_node_port = var.ingress_https_node_port

  domain_name          = var.custom_domain
  extra_domain_names   = var.extra_domain_names
  wait_for_certificate = var.edge_wait_for_certificate
}

# ─── Bord ──────────────────────────────────────────────────

locals {
  # Origine du CDN. CloudFront n'accepte qu'un nom de domaine, jamais une
  # adresse IP : `ingress_hostname` doit donc pointer, par un enregistrement A,
  # sur les IP élastiques d'ingress avant d'activer le CDN. C'est vérifié par
  # la validation de la variable enable_cdn.
  app_origin_host = var.ingress_lb_hostname != "" ? var.ingress_lb_hostname : var.ingress_hostname

  # Point d'entrée public. Avec le CDN, le nom du bord ; sans lui, l'IP
  # d'ingress jointe directement en HTTP — acceptable en dev, ce n'est pas une
  # posture de production (ni WAF, ni terminaison TLS, ni limitation de débit).
  # LE NOM CANONIQUE N'EST PAS FORCEMENT LE PREMIER NOM DU CERTIFICAT, et cette
  # distinction est ce qui a manque. Le certificat de prod porte le nom racine
  # en premier, mais un nom racine ne peut pas etre un CNAME : c'est le www qui
  # resout. L'application fabriquait donc ses URL absolues vers un nom absent du
  # DNS, et le navigateur repondait ERR_NAME_NOT_RESOLVED sur chaque appel
  # d'API — avec, par-dessus, une page servie depuis le cache du service worker,
  # ce qui donnait l'illusion d'une application cassee plutot que d'un nom
  # introuvable.
  #
  # canonical_host dit quel nom l'application annonce ; le certificat et les
  # regles d'ingress, eux, continuent de couvrir les deux.
  public_hostname = (
    var.canonical_host != "" ? var.canonical_host
    : var.custom_domain != "" ? var.custom_domain
    : var.enable_cdn ? module.cloudfront[0].endpoint_hostname
    : module.network.ingress_ip
  )

  public_url = var.enable_cdn || var.custom_domain != "" || var.canonical_host != "" ? "https://${local.public_hostname}" : "http://${local.public_hostname}"

  # Nom porté par la règle d'ingress et sujet du certificat cert-manager.
  # `custom_domain` fait foi ; `ingress_hostname` reste le repli pour un bord
  # personnalisé sans domaine déclaré.
  ingress_host = var.custom_domain != "" ? var.custom_domain : var.ingress_hostname
}

module "cloudfront" {
  count  = var.enable_cdn ? 1 : 0
  source = "../cloudfront"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  names       = module.naming.names
  name_prefix = module.naming.name_prefix
  tags        = module.naming.tags

  app_origin_host        = local.app_origin_host
  origin_protocol_policy = var.cdn_origin_protocol_policy
  assets_origin_domain   = module.s3_assets.regional_domain_name
  assets_bucket          = module.s3_assets.bucket
  assets_bucket_arn      = module.s3_assets.arn

  custom_domain        = var.custom_domain
  wait_for_certificate = var.cdn_wait_for_certificate
  enable_waf           = var.enable_waf
  waf_mode             = var.waf_mode
}

# ─── Observabilité ─────────────────────────────────────────

module "observability" {
  source = "../observability"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project = var.project
  env     = var.env
  names   = module.naming.names
  tags    = module.naming.tags

  retention_days     = var.log_retention_days
  alert_emails       = var.alert_emails
  monthly_budget_usd = var.monthly_budget_usd

  rds_identifier                   = module.rds.identifier
  rds_free_storage_threshold_bytes = var.postgres_allocated_storage * 1024 * 1024 * 1024 * 15 / 100

  # Les alarmes du bord portent sur la distribution : elles n'existent que
  # lorsqu'elle existe, sinon CloudWatch crée une alarme sur une dimension vide
  # qui ne se déclenche jamais.
  enable_cdn_alarms          = var.enable_cdn
  cloudfront_distribution_id = var.enable_cdn ? module.cloudfront[0].distribution_id : ""

  enable_etl_freshness_alert = var.enable_etl_freshness_alert

  # Les sidecars OpenTelemetry exportent sous le rôle IRSA de leur pod. Sans
  # cette politique, le sidecar démarre normalement et échoue silencieusement à
  # l'export — un mode de panne qui ne se voit que par l'absence de traces.
  telemetry_role_names = {
    web  = module.identity.role_names["web"]
    ai   = module.identity.role_names["ai"]
    jobs = module.identity.role_names["jobs"]
  }
}

# ─── Gouvernance ───────────────────────────────────────────

module "governance" {
  source = "../governance"

  name_prefix = module.naming.name_prefix
  region      = var.region
  tags        = module.naming.tags

  # Le blocage public à l'échelle du compte contredirait la lecture anonyme du
  # préfixe assets/, qui est le mode sans CDN : les deux ne peuvent pas être
  # vrais ensemble, et la variable le vérifie.
  block_public_s3_account_wide = var.enforce_policies && var.enable_cdn
  enable_guardduty             = var.enable_guardduty
  enable_security_hub          = var.enable_security_hub
  enable_access_analyzer       = var.enable_access_analyzer
}

# ─── GitOps ────────────────────────────────────────────────

module "gitops" {
  count  = var.gitops_enabled ? 1 : 0
  source = "../gitops"

  env            = var.env
  repository_url = var.gitops_repository_url
  branch         = var.gitops_branch
  use_deploy_key = var.gitops_use_deploy_key
  https_token    = var.gitops_https_token

  # Les valeurs que Flux substitue dans les overlays au moment de la
  # réconciliation — la raison pour laquelle l'application se déploie après un
  # seul apply, sans gabarit à remplir. Toutes non secrètes (ARN, noms, URL
  # publiques).
  substitutions = {
    registry_host = module.ecr.registry_host
    # URL complètes des dépôts : c'est ce que les overlays posent en `newName`,
    # de sorte qu'aucun nom de registre ne soit écrit en dur dans git.
    web_image_repo = module.ecr.repository_urls["web"]
    ai_image_repo  = module.ecr.repository_urls["ai"]
    web_role_arn   = module.identity.role_arns["web"]
    ai_role_arn    = module.identity.role_arns["ai"]
    jobs_role_arn  = module.identity.role_arns["jobs"]
    secret_prefix  = module.naming.names.secret_prefix
    aws_region     = var.region
    cluster_name   = module.runtime_eks.cluster_name
    log_group_name = module.observability.log_group_name

    # Nom public servi par l'ingress : il porte le host de la règle et le sujet
    # du certificat. Vide, l'overlay ne pose pas de bloc TLS et l'environnement
    # reste joint par IP.
    ingress_host = local.ingress_host
    # Nom alternatif servi par le MEME ingress. Il existe parce que le nom
    # racine ne peut pas etre un CNAME : tant que le registrar ne propose pas
    # d'ALIAS, c'est le www qui porte le trafic, et nginx doit donc connaitre
    # les deux — sans quoi il repond 404 a un nom pourtant correctement route
    # et muni d'un certificat valide, ce qui envoie chercher la panne au
    # mauvais endroit.
    ingress_host_alt = length(var.extra_domain_names) > 0 ? var.extra_domain_names[0] : local.ingress_host
    # Adopté par le Service de l'ingress : c'est ce qui fixe l'adresse d'entrée
    # au lieu de laisser le NLB en allouer une nouvelle à chaque recréation.
    ingress_eip_allocations = join(",", module.network.ingress_eip_allocation_ids)
    ingress_lb_type         = var.ingress_lb_type
    # Derriere un ALB, le Service de l'ingress n'a plus a demander de load
    # balancer : il expose deux ports fixes sur les noeuds, et c'est le groupe
    # cible qui vient les chercher. Fixes parce que Terraform doit les
    # connaitre au plan pour creer ce groupe cible dans le meme apply.
    ingress_service_type    = var.enable_edge_alb ? "NodePort" : "LoadBalancer"
    ingress_http_node_port  = tostring(var.ingress_http_node_port)
    ingress_https_node_port = tostring(var.ingress_https_node_port)
    # Le TLS s'arrete au bord : sans cette ligne, nginx voit des requetes en
    # clair, pose une redirection vers HTTPS, et l'ALB la lui renvoie — une
    # boucle qui ne se voit qu'a l'usage.
    ingress_forwarded_headers = var.enable_edge_alb ? "true" : "false"
    # Les deux moities du PROXY protocol, derivees d'une seule decision : le
    # type de load balancer. Un Classic le parle aussi bien qu'un NLB, a
    # condition que la sonde de sante soit en TCP : une sonde HTTP envoie une
    # requete nue sur un port qui attend un preambule, tous les noeuds passent
    # OutOfService, et le load balancer cesse d'acheminer.
    # Le PROXY protocol n'a de sens que devant un load balancer de niveau 4.
    # Derriere l'ALB il est non seulement inutile mais destructeur : nginx
    # attend un preambule que l'ALB n'envoie pas, et repond a chaque requete par
    # une connexion fermee sans un octet. Le lier au type de bord ferme cette
    # contradiction par construction plutot que par vigilance.
    ingress_use_proxy_protocol = (!var.enable_edge_alb && var.ingress_proxy_protocol) ? "true" : "false"
    # Les guillemets font PARTIE de la valeur : kustomize les retire autour du
    # ${...} dans le manifeste, et « * » nu est un alias YAML, pas une chaine.
    ingress_proxy_protocol_annotation = (!var.enable_edge_alb && var.ingress_proxy_protocol) ? "\"*\"" : "\"\""
    acme_email                        = var.acme_email

    site_url     = local.public_url
    supabase_url = var.supabase_url
    assets_url   = var.enable_cdn ? "${module.cloudfront[0].public_url}/assets" : module.s3_assets.direct_assets_base_url

    # Configuration applicative non secrète, tenue ici plutôt que recopiée dans
    # chaque overlay : une valeur qui change (l'URL du SNIS, l'unité racine) est
    # alors un changement de tfvars, pas un changement de manifest.
    dhis2_base_url    = var.dhis2_base_url
    dhis2_username    = var.dhis2_username
    dhis2_root_ou     = var.dhis2_root_ou
    supabase_anon_key = var.supabase_anon_key
    vapid_public_key  = var.vapid_public_key

    # Passe-plat, pas une vraie valeur : réémet la variable d'exécution nginx
    # $http_x_origin_verify inchangée à travers l'unique passe de substitution
    # de Flux, qui la viderait sinon — et une moitié gauche vide ferait accepter
    # au contrôle d'origine toutes les requêtes sans en-tête.
    http_x_origin_verify = "$http_x_origin_verify"
  }

  # Le jeton d'origine : l'ingress rejette toute requête qui ne le porte pas,
  # ce qui empêche de contourner le CDN en visant directement l'adresse
  # d'entrée. La clé est TOUJOURS présente, vide sans CDN — une clé absente
  # laisserait Flux substituer une chaîne vide dans la comparaison nginx, ce qui
  # marche par accident ; une clé vide le dit explicitement, et l'ingress est
  # alors légitimement joint en direct.
  secret_substitutions = {
    origin_verify_token = var.enable_cdn ? module.cloudfront[0].origin_verify_token : ""
  }

  # Rien ne doit être planifié avant que le pilote de secrets et KEDA existent,
  # sinon la première réconciliation échoue sur des types inconnus.
  depends_on = [module.runtime_eks]
}

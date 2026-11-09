// ─── Identité de l'environnement ──────────────────────────

variable "project" {
  description = "Slug du projet."
  type        = string
  default     = "diav1"
}

variable "env" {
  description = "Environnement : dev, staging ou prod."
  type        = string
}

variable "region" {
  description = "Région AWS."
  type        = string
  default     = "eu-west-3"
}

variable "owner" {
  description = "Équipe ou personne responsable."
  type        = string
  default     = "solisbg"
}

variable "cost_center" {
  description = "Centre de coût."
  type        = string
  default     = "diav1"
}

variable "data_classification" {
  description = "Sensibilité des données."
  type        = string
  default     = "internal"
}

// ─── Réseau ───────────────────────────────────────────────

variable "address_space" {
  description = "CIDR du VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "zone_redundant" {
  description = "Trois zones et une NAT par zone. Activé en prod, coupé en dev."
  type        = bool
  default     = false
}

variable "enable_interface_endpoints" {
  description = "Points de terminaison d'interface pour ECR, Secrets Manager, CloudWatch et STS."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "Journaliser les flux rejetés du VPC."
  type        = bool
  default     = true
}

// ─── Exécution ────────────────────────────────────────────

variable "kubernetes_version" {
  description = "Version mineure de Kubernetes."
  type        = string
  default     = "1.31"
}

variable "kubernetes_namespace" {
  description = "Namespace hébergeant l'application."
  type        = string
  default     = "diav1"
}

variable "eks_private_cluster" {
  description = "Fermer l'accès public au serveur d'API."
  type        = bool
  default     = false
}

variable "eks_api_allowed_cidrs" {
  description = "Adresses autorisées sur le point de terminaison public de l'API."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "eks_system_node_instance_type" {
  description = "Type d'instance du groupe système."
  type        = string
  default     = "t3a.medium"
}

variable "eks_system_node_count" {
  description = "Taille du groupe système quand l'autoscaling est coupé."
  type        = number
  default     = 1
}

variable "eks_system_autoscaling_enabled" {
  description = "Autoscaler le groupe système."
  type        = bool
  default     = false
}

variable "eks_system_node_min_count" {
  description = "Plancher du groupe système."
  type        = number
  default     = 1
}

variable "eks_system_node_max_count" {
  description = "Plafond du groupe système."
  type        = number
  default     = 2
}

variable "eks_system_pool_dedicated" {
  description = "Souiller le groupe système pour en écarter les pods applicatifs."
  type        = bool
  default     = true
}

variable "eks_enable_user_pool" {
  description = "Créer un groupe de nœuds applicatif."
  type        = bool
  default     = true
}

variable "eks_user_node_instance_type" {
  description = "Type d'instance du groupe applicatif."
  type        = string
  default     = "t3a.medium"
}

variable "eks_user_node_capacity_type" {
  description = "ON_DEMAND ou SPOT pour le groupe applicatif."
  type        = string
  default     = "ON_DEMAND"
}

variable "eks_user_node_count" {
  description = "Taille du groupe applicatif quand l'autoscaling est coupé."
  type        = number
  default     = 1
}

variable "eks_user_autoscaling_enabled" {
  description = "Autoscaler le groupe applicatif."
  type        = bool
  default     = true
}

variable "eks_user_node_min_count" {
  description = "Plancher du groupe applicatif."
  type        = number
  default     = 1
}

variable "eks_user_node_max_count" {
  description = "Plafond du groupe applicatif."
  type        = number
  default     = 3
}

variable "eks_admin_principal_arns" {
  description = "Principaux IAM recevant l'accès administrateur au cluster."
  type        = list(string)
  default     = []
}

variable "deployer_principal_arn" {
  description = "Rôle du pipeline, qui reçoit l'accès au cluster. Vide, le principal qui exécute cet apply est utilisé."
  type        = string
  default     = ""
}

variable "enable_container_insights" {
  description = "Add-on amazon-cloudwatch-observability."
  type        = bool
  default     = false
}

// ─── Registre et actifs ───────────────────────────────────

variable "ecr_force_delete" {
  description = "Autoriser la destruction d'un dépôt ECR contenant encore des images."
  type        = bool
  default     = false
}

variable "s3_force_destroy" {
  description = "Autoriser la destruction d'un bucket non vide."
  type        = bool
  default     = false
}

// ─── Données ──────────────────────────────────────────────

variable "postgres_version" {
  description = "Version de PostgreSQL."
  type        = string
  # La majeure seule : RDS choisit la derniere mineure disponible. « 16.4 »
  # a ete retire du catalogue et la creation echouait sur « Cannot find version
  # 16.4 for postgres » sans qu'aucun code n'ait change.
  default = "16"
}

variable "postgres_instance_class" {
  description = "Classe d'instance RDS."
  type        = string
  default     = "db.t4g.micro"
}

variable "postgres_allocated_storage" {
  description = "Stockage initial, en Go."
  type        = number
  default     = 20
}

variable "postgres_max_allocated_storage" {
  description = "Plafond de la croissance automatique, en Go."
  type        = number
  default     = 100
}

variable "postgres_backup_retention_days" {
  description = "Rétention des sauvegardes."
  type        = number
  default     = 7
}

variable "postgres_multi_az" {
  description = "Réplique de secours dans une autre zone."
  type        = bool
  default     = false
}

variable "postgres_deletion_protection" {
  description = "Refuser la suppression de l'instance."
  type        = bool
  default     = false
}

variable "postgres_skip_final_snapshot" {
  description = "Ne pas prendre d'instantané final à la destruction."
  type        = bool
  default     = true
}

variable "enable_managed_redis" {
  description = <<-DESC
    Provisionner ElastiCache. Faux par défaut : Redis tourne alors dans le
    cluster, sans ressource AWS ni coût, ce qui convient tant que le contenu du
    cache reste reconstructible.
  DESC
  type        = bool
  default     = false
}

variable "redis_node_type" {
  description = "Type de nœud ElastiCache."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_replica_count" {
  description = "Répliques en lecture."
  type        = number
  default     = 0
}

// ─── Secrets ──────────────────────────────────────────────

variable "secret_recovery_window_days" {
  description = "Fenêtre de récupération des secrets. 0 rend l'environnement reconstructible immédiatement ; 7 à 30 protègent d'une suppression accidentelle."
  type        = number
  default     = 0
}

variable "create_kms_key" {
  description = "Clé KMS propre à l'environnement pour les secrets, RDS et les Secrets Kubernetes."
  type        = bool
  default     = false
}

// ─── Modèles de langage ───────────────────────────────────

variable "enable_bedrock" {
  description = "Autoriser les charges de travail à invoquer Bedrock. L'accès à chaque modèle doit être demandé une fois dans la console du compte."
  type        = bool
  default     = false
}

variable "bedrock_model_ids" {
  description = "Identifiants de modèles autorisés."
  type        = list(string)
  default     = []
}

variable "bedrock_invocation_logging" {
  description = "Journaliser chaque invocation. Réglage unique par compte et par région."
  type        = bool
  default     = false
}

// ─── Bord ─────────────────────────────────────────────────

variable "enable_cdn" {
  description = "Provisionner CloudFront et le WAF devant l'application."
  type        = bool
  default     = false

  validation {
    # CloudFront n'accepte qu'un nom de domaine comme origine, jamais une
    # adresse IP. Sans ce nom, la distribution est créée puis échoue à joindre
    # l'origine, et le diagnostic est long parce que tout le reste est sain.
    condition     = !var.enable_cdn || var.ingress_hostname != ""
    error_message = "enable_cdn exige ingress_hostname : un enregistrement A pointant sur les IP d'ingress (par exemple origin.exemple.org)."
  }
}

variable "ingress_hostname" {
  description = "Nom DNS pointant sur les IP élastiques d'ingress. Origine du CDN, et repli du host d'ingress quand aucun domaine personnalisé n'est déclaré."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Nom public de la plateforme. Vide, le domaine par défaut de CloudFront est utilisé, ou l'IP d'ingress sans CDN."
  type        = string
  default     = ""
}

variable "cdn_origin_protocol_policy" {
  description = "http-only tant que l'ingress ne porte pas de certificat pour le nom d'origine ; https-only ensuite."
  type        = string
  default     = "http-only"
}

variable "cdn_wait_for_certificate" {
  description = "Attendre la validation DNS du certificat pendant l'apply."
  type        = bool
  default     = false
}

variable "enable_waf" {
  description = "Poser un WAF devant la distribution."
  type        = bool
  default     = true
}

variable "waf_mode" {
  description = "Prevention bloque, Detection compte seulement."
  type        = string
  default     = "Prevention"
}

variable "acme_email" {
  description = "Adresse du compte ACME Let's Encrypt, pour le certificat de l'ingress."
  type        = string
  default     = ""
}

// ─── Observabilité ────────────────────────────────────────

variable "log_retention_days" {
  description = "Rétention des groupes de journaux."
  type        = number
  default     = 30
}

variable "alert_emails" {
  description = "Destinataires des alarmes et du budget."
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "Budget mensuel en USD. 0 le désactive."
  type        = number
  default     = 0
}

variable "enable_etl_freshness_alert" {
  description = "Alarme « aucun ETL réussi depuis 5 jours »."
  type        = bool
  default     = true
}

// ─── Gouvernance ──────────────────────────────────────────

variable "enforce_policies" {
  description = "Garde-fous de compte : blocage public S3 à l'échelle du compte."
  type        = bool
  default     = false
}

variable "enable_guardduty" {
  description = "Activer GuardDuty."
  type        = bool
  default     = false
}

variable "enable_security_hub" {
  description = "Activer Security Hub."
  type        = bool
  default     = false
}

variable "enable_access_analyzer" {
  description = "Activer IAM Access Analyzer."
  type        = bool
  default     = true
}

// ─── GitOps ───────────────────────────────────────────────

variable "gitops_enabled" {
  description = "Amorcer Flux sur le cluster."
  type        = bool
  default     = true
}

variable "gitops_repository_url" {
  description = "Dépôt réconcilié."
  type        = string
  default     = "https://github.com/fidelensadi/tbi_pfizer.git"
}

variable "gitops_branch" {
  description = "Branche réconciliée."
  type        = string
  default     = "main"
}

variable "gitops_use_deploy_key" {
  description = "Engendrer une clé de déploiement et l'utiliser pour cloner."
  type        = bool
  default     = true
}

variable "gitops_https_token" {
  description = "Jeton d'accès au dépôt, alternative à la clé de déploiement."
  type        = string
  default     = ""
  sensitive   = true
}

// ─── Pipeline ─────────────────────────────────────────────

variable "create_cicd_role" {
  description = "Créer le rôle assumé par le pipeline."
  type        = bool
  default     = true

  # Le troisieme cas manquait : un environnement qui CREE lui-meme le
  # fournisseur OIDC n'a evidemment pas d'ARN a fournir a l'avance. Sans lui, la
  # regle refusait la configuration la plus normale — celle ou l'on part de
  # zero — et le message envoyait chercher une valeur qui n'existe pas encore.
  validation {
    condition     = !var.create_cicd_role || var.create_github_oidc_provider || var.github_oidc_provider_arn != "" || length(var.cicd_trusted_principal_arns) > 0
    error_message = "create_cicd_role exige create_github_oidc_provider, github_oidc_provider_arn ou cicd_trusted_principal_arns."
  }
}

variable "github_oidc_provider_arn" {
  description = "Fournisseur OIDC GitHub Actions du compte."
  type        = string
  default     = ""
}

variable "github_subjects" {
  description = "Sujets OIDC autorisés à assumer le rôle du pipeline."
  type        = list(string)
  default     = []
}

variable "cicd_trusted_principal_arns" {
  description = "Principaux IAM autorisés à assumer le rôle du pipeline."
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

variable "enable_image_builder" {
  description = "Provisionner les projets CodeBuild qui construisent les images dans AWS. C'est ce qui permet d'amorcer un environnement sans construire sur un poste de travail."
  type        = bool
  default     = true
}

variable "ingress_lb_type" {
  description = <<-DESC
    Type de load balancer du contrôleur d'ingress : « nlb » ou « clb ».

    « nlb » est le choix de conception : il accepte les IP elastiques
    pre-allouees, donc l'adresse d'entree est fixe et connue au plan.

    « clb » est le repli quand le compte AWS refuse les NLB — c'est le cas d'un
    compte recent, qui repond « OperationNotPermitted: This AWS account
    currently does not support creating load balancers » sur elbv2 tout en
    acceptant elb (Classic) et les ALB. Le Service d'ingress reste alors
    <pending> indefiniment et rien n'atteint le cluster.

    Avec « clb », l'entree est un nom DNS et non des adresses fixes : le DNS
    public doit etre un CNAME vers ce nom, et les EIP restent allouees sans
    etre utilisees. Repasser a « nlb » des que la restriction est levee est un
    changement d'une ligne.
  DESC
  type        = string
  default     = "clb"

  validation {
    condition     = contains(["nlb", "clb"], var.ingress_lb_type)
    error_message = "ingress_lb_type doit valoir nlb ou clb."
  }
}

variable "ingress_proxy_protocol" {
  description = <<-DESC
    Activer le PROXY protocol entre le load balancer et nginx, pour que nginx
    voie l'adresse du client plutot que celle du load balancer.

    Ses DEUX moities — la directive nginx et l'annotation du Service — sont
    derivees d'ici, donc elles ne peuvent pas diverger. Elles l'avaient fait :
    la politique restait attachee au load balancer alors que nginx ne
    l'attendait plus, et chaque connexion repondait 400.

    Suppose une sonde de sante en TCP : une sonde HTTP envoie une requete nue
    sur un port qui attend un preambule, tous les noeuds passent OutOfService,
    et le load balancer cesse d'acheminer — pods et ingress parfaitement sains.
  DESC
  type        = bool
  default     = true
}

variable "ingress_lb_hostname" {
  description = <<-DESC
    Nom DNS du load balancer de l'ingress, a utiliser comme origine du CDN.

    Il existe parce que ce nom n'est PAS connu de Terraform : avec un Classic
    Load Balancer, c'est Kubernetes qui le cree en reponse au Service, et son
    nom n'apparait qu'apres coup. La conception d'origine evitait le probleme
    avec des IP elastiques pre-allouees, impossibles sur un Classic.

    Vide, l'origine reste `ingress_hostname` — un nom que l'on pointe soi-meme
    sur le load balancer. Renseigne, CloudFront va directement au load
    balancer et il n'y a plus d'enregistrement d'origine a tenir.

    Se releve ainsi :
      kubectl -n ingress-nginx get svc ingress-nginx-controller         -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
  DESC
  type        = string
  default     = ""
}

variable "restrict_ingress_to_cdn" {
  description = "Ne laisser atteindre l'ingress que par la liste de prefixes CloudFront. Sans effet tant que enable_cdn est faux. A laisser a false le temps que le DNS public bascule sur le CDN."
  type        = bool
  default     = true
}

# ─── Bord ──────────────────────────────────────────────────

variable "enable_edge_alb" {
  description = <<-DESC
    Poser un ALB devant l'ingress, avec un certificat ACM.

    C'est le bord retenu apres verification de ce que ce compte autorise : ni
    NLB (« OperationNotPermitted »), ni CloudFront (« account must be verified »).
    L'ALB apporte le TLS gere par AWS, le routage par nom d'hote, et un nom DNS
    stable — ce que le montage precedent obtenait par des detours.
  DESC
  type        = bool
  default     = true
}

variable "ingress_http_node_port" {
  description = "Port fixe du Service de l'ingress pour HTTP. Fixe pour que le groupe cible existe des le premier apply."
  type        = number
  default     = 30080
}

variable "ingress_https_node_port" {
  description = "Port fixe du Service de l'ingress pour HTTPS."
  type        = number
  default     = 30443
}

variable "extra_domain_names" {
  description = "Noms supplementaires portes par le certificat et servis par le meme bord."
  type        = list(string)
  default     = []
}

variable "edge_wait_for_certificate" {
  description = "Attendre la validation ACM pendant l'apply. Faux tant que les enregistrements ne sont pas poses au registrar."
  type        = bool
  default     = false
}

variable "canonical_host" {
  description = <<-DESC
    Nom que l'application annonce dans ses URL absolues (NEXT_PUBLIC_SITE_URL).

    Distinct de custom_domain a dessein. custom_domain est le PREMIER nom du
    certificat ; canonical_host est celui qui RESOUT et que le navigateur doit
    utiliser. Les deux coincident presque toujours — sauf a l'apex d'une zone,
    ou la norme DNS interdit un CNAME et ou c'est donc le www qui porte le
    trafic.

    Les confondre donne une panne trompeuse : l'application fabrique ses URL
    vers un nom absent du DNS, le navigateur repond ERR_NAME_NOT_RESOLVED sur
    chaque appel d'API, et la page continue de s'afficher depuis le cache du
    service worker — ce qui ressemble a une application cassee plutot qu'a un
    nom introuvable.

    Vide, custom_domain fait foi.
  DESC
  type        = string
  default     = ""
}

# ─── Chaîne de livraison ───────────────────────────────────

variable "enable_cicd" {
  description = "Provisionner le projet CodeBuild qui tient la chaine de livraison de cet environnement."
  type        = bool
  default     = true
}

variable "cicd_manage_source_credential" {
  description = "Declarer l'identifiant GitHub de CodeBuild dans cette region. Un seul par region et par compte : a laisser a true tant qu'un seul environnement l'occupe."
  type        = bool
  default     = true
}

variable "cicd_enable_webhook" {
  description = "Declencher le build a chaque push sur la branche de l'environnement."
  type        = bool
  default     = true
}

variable "create_github_oidc_provider" {
  description = "Creer le fournisseur OIDC GitHub Actions du compte. Un seul pour tout le compte : vrai sur un environnement, faux sur l'autre, qui recoit son ARN par github_oidc_provider_arn."
  type        = bool
  default     = false
}

variable "cicd_enable_codebuild" {
  description = "Provisionner le projet CodeBuild. Faux tant que le compte refuse d'executer un build."
  type        = bool
  default     = false
}

variable "cicd_enable_github_actions" {
  description = "Provisionner ce dont le workflow GitHub Actions a besoin : parametre de build et droit de le lire."
  type        = bool
  default     = true
}

variable "create_ingress_eip" {
  description = "Pre-allouer des IP elastiques pour l'entree. Utile seulement avec un NLB, qui sait les adopter ; un ALB gere les siennes, et les IP restent alors facturees sans etre associees a quoi que ce soit."
  type        = bool
  default     = false
}

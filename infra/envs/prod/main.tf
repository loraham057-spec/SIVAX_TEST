/**
 * Environment prod — budget-constrained "prod-lite".
 *
 * Held under a ~800 USD/month ceiling for dev + prod together, which forces
 * deliberate downgrades versus a full production stack: AKS Free tier (no
 * control-plane SLA), burstable nodes, no PostgreSQL HA or geo-backup, Front
 * Door Standard (no managed WAF), Defender off. Every one of these is a line
 * below, so restoring a full prod is a sizing change, not a redesign.
 *
 * Deliberately reversible: deletion locks and Key Vault purge protection are
 * OFF, so the whole environment can be torn down and rebuilt. Turn them on
 * once the platform is load-bearing — purge protection is a one-way door.
 *
 * The GitHub environment named `prod` must carry a required reviewer; that
 * approval gate is what stands between a merge and a production change.
 */

module "stack" {
  source = "../../modules/stack"

  project         = var.project
  env             = "prod"
  location        = var.location
  subscription_id = var.subscription_id
  alert_emails    = var.alert_emails

  data_classification = "confidential"

  # ─── Runtime: managed Kubernetes ───
  #
  # Un pool système et un pool applicatif, tous deux autoscalés.
  #
  # ⚠️ ARITHMÉTIQUE DU QUOTA. 10 vCPU par région. Le dimensionnement ci-dessous
  # va de 4 vCPU au plancher (1 + 1 nœud) à 8 au plafond (2 + 2), ce qui laisse
  # 2 vCPU de marge pour le surge de 33 % pendant une mise à jour — sans cette
  # marge, un upgrade échoue faute de quota. Monter au-delà suppose de relever
  # le quota (portail → Quotas → Compute → Standard Dsv6 Family).
  orchestrator = var.orchestrator
  # Branche = environnement : ce cluster ne réconcilie que la branche "prod".
  gitops_branch = "prod"
  # Dépôt privé : Flux ne peut pas cloner sans identifiants. La valeur par
  # défaut du module est false, ce que dev surcharge déjà — sans cette ligne le
  # Flux de prod échoue à cloner et le cluster reste vide, infrastructure saine
  # mais sans application.
  gitops_use_deploy_key = true
  gitops_https_token    = var.gitops_https_token
  kubernetes_version    = "1.34"

  aks_private_cluster = true
  aks_sku_tier        = "Free" # pas de SLA sur le plan de contrôle — choix budgétaire

  # Pool système : les add-ons (CoreDNS, Cilium, Container Insights, CSI, KEDA,
  # Flux). Autoscalé lui aussi : un pool figé à un nœud transforme une panne de
  # nœud en indisponibilité de CoreDNS au lieu d'un simple replacement.
  # Un nœud système fixe : autoscalé, il montait à 2 et mangeait les vCPU du
  # pool applicatif. Les add-ons tiennent sur un nœud ; c'est l'applicatif qui
  # doit pouvoir grandir.
  aks_system_node_vm_size        = "Standard_D2s_v6" # 2 vCPU / 8 Go
  aks_system_autoscaling_enabled = false
  aks_system_node_count          = 1
  aks_system_pool_dedicated      = true # les pods applicatifs restent hors du pool système

  # Pool applicatif : web, ai, leurs sidecars, les jobs ETL. Autoscale jusqu'au
  # plafond du quota régional : 2 (système) + 3 (user) = 5 × D2s_v6 = 10 vCPU.
  aks_enable_user_pool         = true
  aks_user_node_vm_size        = "Standard_D2s_v6"
  aks_user_autoscaling_enabled = true # prod garde l'autoscale applicatif
  aks_user_node_min_count      = 1
  # 2 et non 3 : dev (1 nœud) + prod système (1) + prod applicatif (2) = 8 vCPU,
  # ce qui laisse 2 de marge pour le surge de 33 % d'un upgrade. À 3, le quota
  # est saturé et tout upgrade échoue.
  aks_user_node_max_count = 2

  # Même constat que sur dev : la pile Container Insights réserve à elle seule
  # plus du double de l'application. Les sidecars OpenTelemetry continuent
  # d'alimenter Application Insights.
  enable_container_insights = false

  aks_admin_group_object_ids = var.aks_admin_group_object_ids
  aks_ingress_hostname       = var.aks_ingress_hostname
  acme_email                 = var.acme_email

  # Sans quota Front Door, le bord est l'ingress lui-même : le NSG s'ouvre sur
  # 80/443 et le coffre garde un pare-feu explicite.
  enable_frontdoor      = var.enable_frontdoor
  key_vault_allowed_ips = var.key_vault_allowed_ips

  address_space  = "10.40.0.0/16"
  zone_redundant = false

  # ─── Data (budget tiers — no HA, no geo) ───
  postgres_sku                   = "B_Standard_B2s" # burstable, sans HA
  postgres_storage_mb            = 65536
  postgres_backup_retention_days = 7
  postgres_geo_redundant         = false
  postgres_high_availability     = false
  redis_sku                      = "Basic"
  redis_capacity                 = 0
  storage_replication            = "LRS"
  acr_sku                        = "Basic" # registre public (auth) — concession budget

  # ─── Runtime ───
  image_tag        = var.image_tag
  web_min_replicas = 1 # never cold-start a user-facing page
  web_max_replicas = 2
  ai_max_replicas  = 1

  # ─── Edge (Standard — pas de WAF managé Premium) ───
  frontdoor_sku = "Standard_AzureFrontDoor"
  custom_domain = var.custom_domain
  waf_mode      = "Prevention"

  # ─── Observability ───
  log_retention_days = 30
  monthly_budget_eur = 500

  # ─── Governance (allégée + réversible sous ce budget) ───
  enforce_policies           = true # les policies de refus d'accès public sont gratuites
  enable_deletion_locks      = false
  key_vault_retention_days   = 7
  key_vault_purge_protection = false # réversible — rien n'est encore déployé
  defender_plans             = []

  # ─── OpenAI : API externe (pas de quota Azure OpenAI + S0.AccountCount = 1) ───
  enable_openai      = false
  openai_location    = var.openai_location
  openai_deployments = {}

  # ─── Application configuration ───
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

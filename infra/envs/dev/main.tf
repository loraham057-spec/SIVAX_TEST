/**
 * Environment dev.
 *
 * Sized to be cheap and disposable: this is the environment the acceptance
 * criteria say must survive `terraform destroy` followed by `terraform apply`
 * in under 45 minutes with no manual step.
 */

module "stack" {
  source = "../../modules/stack"

  project         = var.project
  env             = "dev"
  location        = var.location
  subscription_id = var.subscription_id
  alert_emails    = var.alert_emails

  # ─── Runtime: managed Kubernetes ───
  orchestrator = var.orchestrator
  # Branch = environment: this cluster reconciles only the "dev" branch, so a
  # deploy pushed to another branch cannot reach it.
  gitops_branch = "dev"
  # Dépôt privé : Flux ne peut pas cloner sans identifiants.
  gitops_use_deploy_key = true
  enable_frontdoor      = var.enable_frontdoor
  key_vault_allowed_ips = var.key_vault_allowed_ips
  kubernetes_version    = "1.34"
  aks_private_cluster   = false  # dev keeps a public API server so kubectl works without a jump host
  aks_sku_tier          = "Free" # no control-plane SLA in dev
  # dev : un nœud système + un nœud applicatif, taille fixe, pas d'autoscale.
  # 4 vCPU sur les 10 du quota régional, que dev partage avec la prod.
  aks_system_node_vm_size        = "Standard_D2s_v6"
  aks_system_autoscaling_enabled = false
  aks_system_node_count          = 1
  aks_system_pool_dedicated      = false # les pods applicatifs peuvent aussi y aller

  aks_enable_user_pool         = true
  aks_user_node_vm_size        = "Standard_D2s_v6"
  aks_user_autoscaling_enabled = false
  aks_user_node_count          = 1

  # Mesuré : avec Container Insights, dev réserve 4806 mCPU et ne tient pas sur
  # deux nœuds (3800 allouables). Sans, 3320 — et l'application n'en demande que
  # 600. Les traces applicatives passent de toute façon par les sidecars
  # OpenTelemetry vers Application Insights, qui eux restent actifs.
  enable_container_insights = false

  aks_admin_group_object_ids = var.aks_admin_group_object_ids
  aks_ingress_hostname       = var.aks_ingress_hostname

  # ─── Network ───
  address_space  = "10.20.0.0/16"
  zone_redundant = false

  # ─── Data: smallest tiers that still exercise the real services ───
  postgres_sku                   = "B_Standard_B1ms"
  postgres_storage_mb            = 32768
  postgres_backup_retention_days = 7
  postgres_high_availability     = false
  redis_sku                      = "Basic"
  redis_capacity                 = 0
  storage_replication            = "LRS"
  acr_sku                        = "Basic"

  # ─── Runtime ───
  image_tag        = var.image_tag
  web_min_replicas = 0 # dev may scale to zero; the AI service never does
  web_max_replicas = 2
  ai_max_replicas  = 1

  # ─── Edge: Standard is enough without Private Link ───
  frontdoor_sku = "Standard_AzureFrontDoor"
  # Vient des tfvars : dev.sivax.health. La valeur était figée à "" ici, ce qui
  # rendait la variable du même nom inopérante.
  custom_domain = var.custom_domain
  waf_mode      = "Detection" # log while tuning, do not block developers

  # ─── Observability ───
  log_retention_days = 30
  monthly_budget_eur = 250

  # ─── Governance: relaxed so the environment can be rebuilt freely ───
  enforce_policies           = false
  enable_deletion_locks      = false
  key_vault_retention_days   = 7
  key_vault_purge_protection = false
  defender_plans             = []

  # ─── OpenAI : API externe (pas de quota Azure OpenAI + S0.AccountCount = 1) ───
  # L'app utilise l'API OpenAI publique via le secret openai-api-key. Aucun
  # compte Azure OpenAI n'est créé. Repasser à true après une hausse de quota.
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

  # ─── Secrets, from GitHub Environment Secrets ───
  openai_api_key            = var.openai_api_key
  dhis2_password            = var.dhis2_password
  resend_api_key            = var.resend_api_key
  elevenlabs_api_key        = var.elevenlabs_api_key
  supabase_service_role_key = var.supabase_service_role_key
  vapid_private_key         = var.vapid_private_key
}

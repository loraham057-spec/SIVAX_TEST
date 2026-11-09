output "tags" {
  description = "Tags applied to every resource in the environment."
  value       = local.tags
}

output "location_short" {
  description = "CAF short code for the region (weu, san…)."
  value       = local.location_short
}

output "resource_group" {
  description = "Resource group name."
  value       = "rg-${local.base}-${local.location_short}"
}

output "names" {
  description = "Resource names, keyed by logical role."
  value = {
    # ─── Network ───
    vnet        = "vnet-${local.base}-${local.location_short}"
    nat_gateway = "natgw-${local.base}"
    nat_ip      = "pip-natgw-${local.base}"
    ingress_ip  = "pip-ingress-${local.base}"
    nsg_runtime = "nsg-runtime-${local.base}"
    nsg_aks     = "nsg-aks-${local.base}"

    # ─── Identity (one per workload, so a compromise is scoped) ───
    identity_web  = "id-${var.project}-web-${var.env}"
    identity_ai   = "id-${var.project}-ai-${var.env}"
    identity_jobs = "id-${var.project}-jobs-${var.env}"
    identity_cicd = "id-${var.project}-cicd-${var.env}"

    # ─── Data ───
    # Key Vault: globally unique, 24 chars max, hyphens allowed.
    key_vault = substr("kv-${local.base}-${local.unique_suffix}", 0, 24)
    # Storage and ACR: globally unique, lowercase alphanumeric only.
    storage  = substr("st${var.project}${var.env}${local.unique_suffix}", 0, 24)
    acr      = substr("acr${var.project}${var.env}${local.unique_suffix}", 0, 50)
    # Globalement unique lui aussi : le nom porte le FQDN
    # <name>.postgres.database.azure.com. Sans le suffixe, deux abonnements du
    # meme projet se disputent le nom — vecu lors de la migration, l ancien
    # abonnement occupait encore psql-diav1-dev-frc.
    postgres = "psql-${local.base}-${local.location_short}-${local.unique_suffix}"
    database = replace(var.project, "-", "_")
    redis    = "redis-${local.base}-${local.location_short}"
    openai   = "oai-${local.base}-${local.location_short}"

    # ─── Runtime ───
    container_app_env = "cae-${local.base}-${local.location_short}"
    app_web           = "ca-${var.project}-web-${var.env}"
    app_ai            = "ca-${var.project}-ai-${var.env}"
    job_etl           = "caj-${var.project}-etl-${var.env}"
    job_ml            = "caj-${var.project}-mltrain-${var.env}"
    job_migrate       = "caj-${var.project}-dbmigrate-${var.env}"
    aks               = "aks-${local.base}-${local.location_short}"

    # ─── Edge ───
    frontdoor    = "afd-${local.base}"
    frontdoor_ep = "afde-${local.base}"
    waf_policy   = replace("waf${var.project}${var.env}", "-", "")

    # ─── Observability ───
    log_analytics = "log-${local.base}-${local.location_short}"
    app_insights  = "appi-${local.base}-${local.location_short}"
    action_group  = "ag-${local.base}"
  }
}

/**
 * Module naming — single source of truth for resource names and tags.
 *
 * Every other module receives its name from here rather than composing one
 * locally, so a convention change is a one-file change. Names follow the Cloud
 * Adoption Framework abbreviations (rg-, vnet-, ca-, kv-…) suffixed with
 * project, environment and a short region code:
 *
 *     rg-diav1-prod-weu        ca-diav1-web-prod        kv-diav1-prod-a1b2
 *
 * Two Azure constraints shape the code below: some resources forbid hyphens
 * and are globally unique (storage, ACR), and Key Vault names are globally
 * unique but only 24 characters. Both get a deterministic short suffix derived
 * from the subscription and environment, so the name is stable across applies
 * without being guessable by another tenant.
 */

locals {
  # Region → CAF short code. Extend as regions are added.
  location_short_map = {
    westeurope       = "weu"
    northeurope      = "neu"
    francecentral    = "frc"
    southafricanorth = "san"
    swedencentral    = "sdc"
    uksouth          = "uks"
    eastus           = "eus"
  }

  location_short = lookup(local.location_short_map, var.location, substr(replace(var.location, "/[^a-z]/", ""), 0, 3))

  # Deterministic 4-char suffix for globally-unique names.
  unique_suffix = substr(sha256("${var.subscription_id}-${var.project}-${var.env}"), 0, 4)

  base = "${var.project}-${var.env}"

  # Applied to every resource. `data-classification` matters here: the platform
  # holds aggregated public-health data, and the tag is what Azure Policy keys
  # on to enforce the stricter controls.
  tags = merge(
    {
      project             = var.project
      env                 = var.env
      owner               = var.owner
      cost-center         = var.cost_center
      data-classification = var.data_classification
      managed-by          = "terraform"
    },
    var.extra_tags,
  )
}

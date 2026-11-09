/**
 * Module keyvault — the single place a secret value is allowed to live.
 *
 * RBAC mode, not access policies: permissions are Azure role assignments,
 * auditable and manageable like any other, instead of a per-vault ACL that no
 * policy engine can see.
 *
 * Two of the secrets here are GENERATED rather than supplied, because their
 * current handling is a live defect:
 *
 *  · push_internal_token — the application falls back to a literal published in
 *    the repository (SEC-02). Generating it and making it mandatory closes that
 *    path; the old value must still be revoked separately.
 *
 *  · app_settings_encryption_key — the application derives it from
 *    SUPABASE_SERVICE_ROLE_KEY when unset (SEC-09), so rotating that key would
 *    render every stored setting permanently undecryptable. It must exist
 *    BEFORE any migration.
 *
 * The PostgreSQL admin password is generated too: nobody needs to know it.
 */

resource "azurerm_key_vault" "main" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  tenant_id           = var.tenant_id
  sku_name            = "standard"
  tags                = var.tags

  rbac_authorization_enabled = true
  soft_delete_retention_days = var.soft_delete_retention_days
  # Irreversible once on — deliberately prod-only.
  purge_protection_enabled = var.purge_protection_enabled

  # Terraform writes the secrets from OUTSIDE the VNet — a GitHub runner, or a
  # workstation. With the data plane fully closed, every secret write fails
  # with "Public network access is disabled and request is not from a trusted
  # service nor via an approved private link".
  #
  # So the endpoint stays reachable, but the firewall denies by default and
  # admits only the deployer's address. Workloads never use this path: they
  # reach the vault through the private endpoint below. Set
  # public_network_access_enabled = false once Terraform runs from inside the
  # VNet (a self-hosted runner), which is the stricter end state.
  public_network_access_enabled = var.public_network_access_enabled

  network_acls {
    bypass         = "AzureServices"
    default_action = length(var.allowed_ip_rules) > 0 ? "Deny" : "Allow"
    ip_rules       = var.allowed_ip_rules
  }
}

resource "azurerm_private_endpoint" "keyvault" {
  name                = "pe-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}"
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

# ─── Access ────────────────────────────────────────────────

# The Terraform principal needs to write the secrets it manages.
resource "azurerm_role_assignment" "terraform_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.terraform_principal_id
}

# Workloads only ever read.
resource "azurerm_role_assignment" "readers" {
  for_each             = var.reader_principal_ids
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = each.value
}

# ─── Generated secrets ─────────────────────────────────────

resource "random_password" "postgres_admin" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "push_internal_token" {
  length  = 48
  special = false
}

resource "random_password" "app_settings_encryption_key" {
  length  = 64
  special = false
}

locals {
  generated_secrets = {
    postgres-admin-password     = random_password.postgres_admin.result
    push-internal-token         = random_password.push_internal_token.result
    app-settings-encryption-key = random_password.app_settings_encryption_key.result
  }

  # Third-party secrets arrive from GitHub Environment Secrets via TF_VAR_*.
  # Their values are known at plan (a literal or an empty default), so empties
  # can be skipped safely — bring an environment up before every integration is
  # provisioned. The connection strings composed from other resources come in
  # through `computed_secrets` instead: their values are unknown at plan, so
  # they must never drive the `if` filter or the for_each key set.
  supplied_secrets = { for k, v in var.secrets : k => v if v != "" }

  all_secrets = merge(local.generated_secrets, local.supplied_secrets, var.computed_secrets)
}

# for_each iterates the secret NAMES (non-sensitive, known at plan); the value
# — which may be sensitive or computed — is looked up in the body. Passing the
# map itself to for_each fails: Terraform forbids sensitive values as instance
# keys.
resource "azurerm_key_vault_secret" "main" {
  # keys() stays tainted sensitive because the map has sensitive values, but the
  # secret NAMES are not secret — de-sensitize them so they can be instance keys.
  for_each     = nonsensitive(toset(keys(local.all_secrets)))
  name         = each.key
  value        = local.all_secrets[each.key]
  key_vault_id = azurerm_key_vault.main.id
  content_type = "text/plain"
  tags         = var.tags

  depends_on = [azurerm_role_assignment.terraform_officer]
}

# ─── Diagnostics ───────────────────────────────────────────
#
# Every read of a secret is logged. This is what makes SEC-10 (revealing a
# secret through /api/settings/reveal) auditable at the platform level.

resource "azurerm_monitor_diagnostic_setting" "keyvault" {
  count                      = var.enable_diagnostics ? 1 : 0
  name                       = "diag-${var.name}"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

/**
 * Module governance — policy, locks and Defender.
 *
 * The policies here are the safety net behind the network design: every data
 * service is already private, and these assignments make it impossible to
 * quietly un-private one of them later. That matters more than usual on a
 * platform holding national health data, where the difference between
 * "configured privately" and "cannot be public" is what an auditor asks about.
 *
 * Deletion locks and purge protection are prod-only and irreversible in
 * practice — enable them knowingly.
 */

data "azurerm_policy_definition" "deny_public_network_access" {
  display_name = "Storage accounts should disable public network access"
}

data "azurerm_policy_definition" "postgres_public_access" {
  display_name = "Public network access should be disabled for PostgreSQL flexible servers"
}

data "azurerm_policy_definition" "require_tags" {
  display_name = "Require a tag on resources"
}

resource "azurerm_resource_group_policy_assignment" "storage_private" {
  count                = var.enforce_policies ? 1 : 0
  name                 = "deny-public-storage"
  resource_group_id    = var.resource_group_id
  policy_definition_id = data.azurerm_policy_definition.deny_public_network_access.id
  description          = "Storage accounts must not be reachable from the public internet."
  enforce              = true
}

resource "azurerm_resource_group_policy_assignment" "postgres_private" {
  count                = var.enforce_policies ? 1 : 0
  name                 = "deny-public-postgres"
  resource_group_id    = var.resource_group_id
  policy_definition_id = data.azurerm_policy_definition.postgres_public_access.id
  description          = "PostgreSQL must be reachable only through VNet injection."
  enforce              = true
}

# One assignment per mandatory tag: the built-in definition takes a single name.
resource "azurerm_resource_group_policy_assignment" "required_tags" {
  for_each = var.enforce_policies ? toset(var.required_tags) : toset([])

  name                 = "require-tag-${each.value}"
  resource_group_id    = var.resource_group_id
  policy_definition_id = data.azurerm_policy_definition.require_tags.id
  description          = "Every resource must carry the ${each.value} tag."
  enforce              = true

  parameters = jsonencode({
    tagName = { value = each.value }
  })
}

# ─── Deletion locks ────────────────────────────────────────
#
# Guards against the accident that has no undo: dropping the warehouse or the
# vault holding the key that decrypts application settings.

resource "azurerm_management_lock" "protected" {
  for_each = var.locked_resource_ids

  name       = "lock-${each.key}"
  scope      = each.value
  lock_level = "CanNotDelete"
  notes      = "Production data. Remove the lock deliberately before any destroy."
}

# ─── Defender for Cloud ────────────────────────────────────

resource "azurerm_security_center_subscription_pricing" "plans" {
  for_each = var.defender_plans

  tier          = "Standard"
  resource_type = each.value
}

/**
 * Bootstrap — the Terraform state backend, created by Terraform itself.
 *
 * Same job as bootstrap.sh, expressed in Terraform for environments where the
 * az CLI is not available. It creates only the chicken-and-egg pair: the
 * resource group and storage account that hold every other environment's
 * state.
 *
 * This configuration keeps its OWN state as a local file, on purpose — it
 * cannot store its state in the account it is creating. That file is the one
 * piece of Terraform state not held remotely; it is gitignored, and losing it
 * is recoverable by importing the two resources.
 *
 * The service principal is NOT created here: it already exists (see
 * infra/azure-configs.txt) and creating Entra objects needs directory
 * permissions this principal does not have.
 *
 *   cd infra/bootstrap/terraform
 *   terraform init && terraform apply
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
  # Local state, deliberately: this config creates the remote backend.
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # Authenticates from ARM_CLIENT_ID / ARM_CLIENT_SECRET / ARM_TENANT_ID.

  # Required because the account below disables shared-key access: without it
  # the provider still reaches the data plane (queue and static-website
  # properties) with a key and fails on
  # "Key based authentication is not permitted on this storage account".
  storage_use_azuread = true
}

resource "azurerm_resource_group" "tfstate" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    project    = var.project
    purpose    = "tfstate"
    managed-by = "terraform-bootstrap"
  }
}

resource "azurerm_storage_account" "tfstate" {
  name                = var.storage_account_name
  resource_group_name = azurerm_resource_group.tfstate.name
  location            = azurerm_resource_group.tfstate.location

  account_tier             = "Standard"
  account_replication_type = var.replication_type
  account_kind             = "StorageV2"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false

  # The state legitimately contains secret values — that is inherent to
  # azurerm_key_vault_secret. Disabling shared-key access means a leaked
  # storage key cannot be used to read it: only Entra identities can.
  shared_access_key_enabled = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  tags = {
    project    = var.project
    purpose    = "tfstate"
    managed-by = "terraform-bootstrap"
  }
}

# The principal running Terraform must be able to read and write the state
# blobs. Contributor on the subscription does NOT grant data-plane access to
# blobs — that is a separate role, and its absence is the usual cause of a
# 403 on `terraform init` right after bootstrap.
#
# It must also come BEFORE the container: with shared_access_key_enabled =
# false the provider reaches the data plane through Entra, so creating the
# container without this role fails on a 403 it reports as a data-plane timeout.
resource "azurerm_role_assignment" "state_data_access" {
  count                = var.terraform_principal_object_id == "" ? 0 : 1
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.terraform_principal_object_id
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  # Role assignments take a little while to propagate; without waiting, the
  # very first container create races the RBAC replication and 403s.
  depends_on = [
    azurerm_role_assignment.state_data_access,
    time_sleep.rbac_propagation,
  ]
}

resource "time_sleep" "rbac_propagation" {
  depends_on      = [azurerm_role_assignment.state_data_access]
  create_duration = "60s"
}

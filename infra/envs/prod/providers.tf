terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Parameterised with -backend-config=backend.hcl so the same code serves
  # every environment while each keeps its own state file.
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      # Never purge a vault on destroy: the soft-delete window is the last
      # chance to recover a secret deleted by mistake.
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }

  # OIDC federation in CI — no client secret anywhere. Set ARM_USE_OIDC=false
  # and supply ARM_CLIENT_SECRET to run Terraform locally with a service
  # principal secret; the CI leaves this at its default.
  use_oidc        = var.use_oidc
  subscription_id = var.subscription_id

  # The state account disables shared-key access, so every data-plane call must
  # go through Entra.
  storage_use_azuread = true
}

provider "azuread" {
  use_oidc = var.use_oidc
}

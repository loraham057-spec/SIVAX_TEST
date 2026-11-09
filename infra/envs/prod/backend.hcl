resource_group_name  = "rg-diav1x-tfstate"
storage_account_name = "stdiav1xtfstate"
container_name       = "tfstate"
key                  = "prod.terraform.tfstate"

# Authentication is configured entirely through the environment, because this
# Terraform version's azurerm backend rejects use_oidc / use_azuread_auth as
# block arguments:
#   ARM_USE_AZUREAD=true   — the state account disables shared-key access
#   ARM_USE_OIDC=true      — in CI; locally, supply ARM_CLIENT_SECRET instead

#!/usr/bin/env bash
#
# infra/bootstrap/bootstrap.sh
#
# The only step that is not Terraform, and it runs ONCE per subscription.
#
# There is an irreducible chicken-and-egg problem: Terraform needs an identity
# to act with, and a place to keep its state — neither of which can be created
# by the Terraform that depends on them. The answer is not to click through the
# Azure portal, it is to script the two of them here.
#
# Creates:
#   1. The remote state storage account (versioned, soft-delete, Entra-only)
#   2. The Terraform service principal
#   3. GitHub OIDC federated credentials — no client secret is ever created
#   4. The role assignments Terraform needs to manage the subscription
#
# Requires an operator holding:
#   - Application Administrator (or Cloud Application Administrator) on the tenant
#   - Owner (or Contributor + User Access Administrator) on the subscription
#
# Usage:
#   AZURE_SUBSCRIPTION_ID=<guid> ./bootstrap.sh
#   AZURE_SUBSCRIPTION_ID=<guid> ./bootstrap.sh --dry-run
#
set -euo pipefail

# ─── Parameters ────────────────────────────────────────────

SUB_ID="${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID must be set}"
GH_ORG="${GH_ORG:-fidelensadi}"
GH_REPO="${GH_REPO:-tbi_pfizer}"
LOC="${AZURE_LOCATION:-westeurope}"
PROJECT="${PROJECT:-diav1}"

RG_TF="rg-${PROJECT}-tfstate"
SA_TF="st${PROJECT}tfstate"
SP_NAME="sp-${PROJECT}-terraform"
ENVIRONMENTS=("dev" "staging" "prod")

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

command -v az >/dev/null || { echo "az CLI is required — https://aka.ms/azure-cli"; exit 1; }

say "Subscription ${SUB_ID} · region ${LOC} · repo ${GH_ORG}/${GH_REPO}"
run az account set --subscription "$SUB_ID"

# ─── 1. Terraform remote state ─────────────────────────────
#
# Shared-key access is disabled: the state is reachable only through Entra
# identities, which means a leaked storage key cannot be used to read it. The
# state legitimately contains secret values (that is inherent to
# azurerm_key_vault_secret), so this is not optional.

say "1/4 — Remote state storage"
run az group create -n "$RG_TF" -l "$LOC" \
  --tags project="$PROJECT" managed-by=bootstrap purpose=tfstate

run az storage account create -n "$SA_TF" -g "$RG_TF" -l "$LOC" \
  --sku Standard_ZRS --kind StorageV2 --min-tls-version TLS1_2 \
  --allow-blob-public-access false --allow-shared-key-access false \
  --tags project="$PROJECT" managed-by=bootstrap

run az storage account blob-service-properties update -n "$SA_TF" -g "$RG_TF" \
  --enable-versioning true --enable-delete-retention true --delete-retention-days 30

run az storage container create -n tfstate --account-name "$SA_TF" --auth-mode login

# ─── 2. Terraform service principal ────────────────────────

say "2/4 — Terraform service principal"
if $DRY_RUN; then
  APP_ID="00000000-0000-0000-0000-000000000000"
  echo "  [dry-run] az ad app create --display-name $SP_NAME"
else
  APP_ID=$(az ad app list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
  if [[ -z "$APP_ID" ]]; then
    APP_ID=$(az ad app create --display-name "$SP_NAME" --query appId -o tsv)
    az ad sp create --id "$APP_ID" >/dev/null
  else
    echo "  already exists — reusing $APP_ID"
  fi
  SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
fi

# ─── 3. GitHub OIDC federation ─────────────────────────────
#
# This is what removes the need for a client secret entirely. GitHub Actions
# presents a short-lived OIDC token; Entra trades it for an Azure token. There
# is nothing to store, nothing to rotate, and nothing to leak.

say "3/4 — GitHub OIDC federated credentials"
for ENVNAME in "${ENVIRONMENTS[@]}"; do
  echo "  · environment:${ENVNAME}"
  run az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"gh-${ENVNAME}\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GH_ORG}/${GH_REPO}:environment:${ENVNAME}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"
done

# Pull requests run `plan` only; they get their own subject so the environment
# credentials cannot be borrowed by a fork.
echo "  · pull_request (plan only)"
run az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"gh-pr\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${GH_ORG}/${GH_REPO}:pull_request\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"

# ─── 4. Role assignments ───────────────────────────────────
#
# Contributor creates resources; RBAC Administrator lets Terraform create the
# role assignments the managed identities need (AcrPull, Key Vault Secrets
# User…). Deliberately NOT Owner, and deliberately not at management-group
# scope.

say "4/4 — Role assignments"
if ! $DRY_RUN; then
  run az role assignment create --assignee-object-id "$SP_OID" \
    --assignee-principal-type ServicePrincipal \
    --role "Contributor" --scope "/subscriptions/$SUB_ID"

  run az role assignment create --assignee-object-id "$SP_OID" \
    --assignee-principal-type ServicePrincipal \
    --role "Role Based Access Control Administrator" --scope "/subscriptions/$SUB_ID"

  run az role assignment create --assignee-object-id "$SP_OID" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "/subscriptions/$SUB_ID/resourceGroups/$RG_TF/providers/Microsoft.Storage/storageAccounts/$SA_TF"
fi

# ─── Output ────────────────────────────────────────────────
#
# These three values are GUIDs, not secrets. Store them as GitHub *variables*
# (not secrets) so they are visible in workflow logs for debugging.

say "Done — set these as GitHub Actions variables (vars.*, not secrets)"
cat <<EOF

  AZURE_CLIENT_ID=${APP_ID}
  AZURE_TENANT_ID=$($DRY_RUN && echo "<tenant-guid>" || az account show --query tenantId -o tsv)
  AZURE_SUBSCRIPTION_ID=${SUB_ID}

Next:
  1. Create the GitHub environments dev / staging / prod, with a required
     reviewer on prod.
  2. Add the third-party secrets listed in infra/bootstrap/README.md as
     GitHub Environment Secrets.
  3. cd infra/envs/dev && terraform init -backend-config=backend.hcl && terraform apply

From this point on, nothing is created by hand.
EOF

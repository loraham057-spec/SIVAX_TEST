# Infrastructure — Terraform

Toute l'infrastructure Azure de DIAV1 est décrite ici. Après le script
d'amorçage (`bootstrap/`), **aucune ressource n'est créée, modifiée ou
supprimée à la main dans le portail Azure**.

## Arborescence

```
infra/
├── .terraform-version          # tfenv — 1.9.8, la version utilisée par la CI
├── bootstrap/                  # le seul geste hors Terraform, une fois
├── modules/
│   ├── naming/                 # convention de noms + tags obligatoires
│   ├── network/                # VNet, subnets, NAT Gateway, DNS privé
│   ├── identity/               # une identité managée par charge de travail
│   ├── keyvault/               # secrets, dont 3 générés par Terraform
│   ├── postgresql/             # Flexible Server injecté dans le VNet
│   ├── redis/                  # cache et rate limiting partagés
│   ├── storage/                # assets statiques, exports, artefacts ML
│   ├── acr/                    # registre d'images
│   ├── openai/                 # compte + déploiements de modèles
│   ├── observability/          # Log Analytics, App Insights, alertes, budgets
│   ├── frontdoor/              # CDN, WAF, rate limiting, domaine custom
│   ├── runtime-aca/            # Container Apps : 2 services + 3 jobs
│   ├── governance/             # Azure Policy, verrous, Defender
│   └── stack/                  # compose tout ce qui précède
├── envs/
│   ├── dev/                    # jetable, dimensionné au minimum
│   ├── staging/                # iso-prod en topologie, réduit en taille
│   └── prod/                   # HA, verrous, purge protection
└── policies/                   # règles de sécurité IaC vérifiées en CI
```

**Un répertoire par environnement, pas des workspaces.** Les environnements
diffèrent par leur dimensionnement et leurs options de sûreté ; un répertoire
rend ces écarts explicites en revue de code, et chacun possède son propre
fichier d'état, ce qui borne le rayon d'action d'une erreur.

Le module `stack` évite pour autant toute duplication : les trois `main.tf`
d'environnement l'appellent avec des valeurs différentes. **Le code Terraform
est le même partout ; seules les variables changent.**

## Utilisation

```bash
cd infra/envs/dev
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

En CI, l'authentification passe par la fédération OIDC GitHub → Entra : aucun
secret client n'existe. En local, `az login` suffit — retirez alors
`use_oidc = true` de `providers.tf` ou exportez `ARM_USE_CLI=true`.

### Créer un quatrième environnement

```bash
cp -r envs/dev envs/demo
# ajuster envs/demo/main.tf (env = "demo"), backend.hcl (key) et terraform.tfvars
```

Aucun module n'est à modifier.

## Décisions structurantes

| Décision | Motif |
|----------|-------|
| **Container Apps, pas AKS** | Deux services et trois jobs. AKS coûte 400 à 800 €/mois de plus en production et exige une astreinte, pour un bénéfice technique nul à ce stade. Les déclencheurs de bascule sont listés au §5.2 de `improve.md`. |
| **Environment interne + Front Door** | Le runtime n'a aucune adresse publique. Front Door est le seul point d'entrée, avec WAF et rate limiting. |
| **Toutes les données en accès privé** | PostgreSQL en injection VNet ; Redis, Key Vault, Storage, ACR et OpenAI en private endpoint. Azure Policy refuse par-dessus tout accès public, pour qu'une erreur future ne puisse pas les exposer silencieusement. |
| **NAT Gateway** | Donne une IP de sortie **fixe**, à communiquer au ministère pour une éventuelle allow-list côté SNIS RDC. Aujourd'hui l'IP de sortie n'est pas maîtrisée. `terraform output egress_ip`. |
| **Une identité par charge de travail** | web, ai, jobs, cicd. La compromission de l'une n'hérite pas des droits des autres, et le journal d'audit nomme l'appelant réel. |
| **Aucun secret en variable d'environnement** | Chaque `secret{}` est une référence Key Vault résolue à l'exécution par l'identité managée. Inspecter un conteneur en production ne révèle que des références. |
| **L'ETL est un Job cron** | En processus, chaque réplica déclenche sa propre synchronisation à 03:00 et multiplie la charge sur SNIS RDC. Le service web est déployé avec `ETL_SCHEDULER_ENABLED=false`. |
| **Supabase conservé en phase 1** | 8 migrations dépendent du schéma `auth` de Supabase (`auth.users`, `auth.uid()`) qu'un PostgreSQL Azure nu n'accepte pas. Migrer le calcul est réversible en quelques minutes par un retour DNS ; migrer l'identité ne l'est pas. |

## Secrets générés par Terraform

Trois secrets ne sont saisis par personne — Terraform les génère et les dépose
en Key Vault. Deux d'entre eux corrigent des défauts actifs :

| Secret | Pourquoi il est généré |
|--------|------------------------|
| `postgres-admin-password` | Personne n'a besoin de le connaître ; l'accès courant passe par Entra. |
| `push-internal-token` | La valeur de repli actuelle est **publiée dans le dépôt** (SEC-02). ⚠️ La générer ne suffit pas : l'ancienne valeur doit être révoquée, elle est dans l'historique Git. |
| `app-settings-encryption-key` | L'application la dérive aujourd'hui de `SUPABASE_SERVICE_ROLE_KEY` (SEC-09) ; une rotation de cette clé rendrait `app_settings` définitivement indéchiffrable. **Doit exister avant toute migration.** |

## Ce qui reste hors Terraform

| # | Élément | Contournement |
|---|---------|---------------|
| 1-2 | Service principal + compte de stockage d'état | `bootstrap/bootstrap.sh`, une fois |
| 3 | Quota Azure OpenAI (TPM) | Demande de support Microsoft. Terraform crée le déploiement, pas le plafond. **Prévoir le délai.** |
| 4 | « Autoriser les principaux de service » dans le portail Power BI | **Seul point réellement manuel.** Une case à cocher, une fois. |
| 5 | Consentement admin aux permissions Graph | `az ad app permission admin-consent` |
| 6 | Délégation NS de `solisbg.com` | Chez le registrar. Alternative : n'y créer que le CNAME et le TXT retournés par `terraform output dns_validation`. |
| 7 | Valeurs initiales des secrets tiers | GitHub Environment Secrets, puis Key Vault par Terraform |

## Critères d'acceptation

1. `terraform destroy` puis `apply` sur `dev` reconstruit un environnement
   fonctionnel sans action manuelle, en moins de 45 minutes.
2. Aucune ressource Azure ne porte `managed-by` différent de `terraform`, hors
   les deux ressources d'amorçage.
3. `iac-drift.yml` sort en code 0 sur les trois environnements.
4. `gitleaks` et `checkov` passent ; l'inspection d'un conteneur en production
   ne révèle que des références Key Vault.
5. Déployer une nouvelle version applicative se fait par un `git push`.
6. Créer un quatrième environnement ne demande qu'un répertoire et ses tfvars.
7. La documentation d'exploitation ne contient aucune instruction commençant par
   « dans le portail Azure, cliquez sur… ».

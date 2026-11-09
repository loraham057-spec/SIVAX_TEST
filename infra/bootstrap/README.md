# Amorçage — la seule étape hors Terraform

`bootstrap.sh` s'exécute **une seule fois par abonnement**. Il crée les deux
objets que Terraform ne peut pas créer lui-même (son identité et l'emplacement
de son état), puis plus rien n'est fait à la main.

```bash
AZURE_SUBSCRIPTION_ID=<guid> ./bootstrap.sh --dry-run   # vérifier ce qui sera fait
AZURE_SUBSCRIPTION_ID=<guid> ./bootstrap.sh
```

Le script est idempotent : relancé, il réutilise le service principal existant
au lieu d'en créer un second.

## Droits requis par l'opérateur

| Portée | Rôle |
|--------|------|
| Tenant Entra | Application Administrator (ou Cloud Application Administrator) |
| Abonnement | Owner, ou Contributor + User Access Administrator |

Ces droits ne sont nécessaires que pour cette exécution. Le service principal
créé reçoit délibérément moins : `Contributor` + `Role Based Access Control
Administrator`, **jamais `Owner`**, jamais au niveau *management group*.

## Ce que le script produit

1. `rg-diav1-tfstate` / `stdiav1tfstate` — état Terraform versionné, soft-delete
   30 jours, `allow_shared_key_access = false` (accès Entra uniquement).
2. `sp-diav1-terraform` — le service principal utilisé par la CI.
3. Quatre identifiants fédérés OIDC : un par environnement GitHub
   (`dev`, `staging`, `prod`) plus un pour les pull requests, limité au `plan`.
4. Les attributions de rôles ci-dessus.

**Aucun secret client n'est créé.** La fédération OIDC donne les mêmes droits
sans rien à stocker, faire tourner ni révoquer. Si la politique de votre
organisation impose malgré tout un secret client, voir la section 5.7 de
`improve.md` pour les contraintes à respecter.

## Après le script

### 1. Variables GitHub Actions (pas des secrets)

Ce sont des GUID publics — les déclarer en *variables* les rend lisibles dans
les journaux, ce qui aide au diagnostic.

| Variable | Source |
|----------|--------|
| `AZURE_CLIENT_ID` | sortie du script |
| `AZURE_TENANT_ID` | sortie du script |
| `AZURE_SUBSCRIPTION_ID` | votre abonnement |

### 2. Environnements GitHub

Créer `dev`, `staging` et `prod`. Sur `prod`, exiger au moins un relecteur :
c'est ce qui matérialise l'approbation manuelle avant `terraform apply`.

### 3. Secrets d'environnement

Ces valeurs naissent chez des tiers ; elles sont saisies une fois ici, puis
poussées en Key Vault par Terraform. Elles ne doivent jamais apparaître dans un
`.tfvars`.

| Secret GitHub | Variable Terraform | Utilisé par |
|---------------|--------------------|-------------|
| `OPENAI_API_KEY` | `TF_VAR_openai_api_key` | assistant IA (repli hors Azure OpenAI) |
| `DHIS2_PASSWORD` | `TF_VAR_dhis2_password` | ETL et outil DHIS2 |
| `DHIS2_USERNAME` | `TF_VAR_dhis2_username` | idem |
| `RESEND_API_KEY` | `TF_VAR_resend_api_key` | e-mails transactionnels |
| `ELEVENLABS_API_KEY` | `TF_VAR_elevenlabs_api_key` | dictée vocale |
| `SUPABASE_SERVICE_ROLE_KEY` | `TF_VAR_supabase_service_role_key` | accès base en phase 1 |
| `SUPABASE_URL` | `TF_VAR_supabase_url` | idem |
| `SUPABASE_ANON_KEY` | `TF_VAR_supabase_anon_key` | client navigateur |
| `VAPID_PRIVATE_KEY` | `TF_VAR_vapid_private_key` | notifications push |
| `VAPID_PUBLIC_KEY` | `TF_VAR_vapid_public_key` | idem |

Trois secrets ne figurent pas dans cette liste parce que **Terraform les
génère** (`random_password`) et qu'aucun humain n'a besoin de les connaître :

- le mot de passe administrateur PostgreSQL ;
- `PUSH_INTERNAL_TOKEN` — dont la valeur de repli est aujourd'hui publiée dans
  le dépôt (SEC-02) et doit être révoquée ;
- `APP_SETTINGS_ENCRYPTION_KEY` — qui retombe aujourd'hui sur
  `SUPABASE_SERVICE_ROLE_KEY`, si bien qu'une rotation de cette dernière rendrait
  `app_settings` définitivement indéchiffrable (SEC-09).

### 4. Premier apply

```bash
cd infra/envs/dev
terraform init -backend-config=backend.hcl
terraform apply
```

## Ce qui restera manuel

Sept points ne sont pas couvrables par Terraform (section 5.13 de `improve.md`).
Six sont scriptés ici ou dans la CI. **Un seul est réellement manuel** : la case
« Autoriser les principaux de service à utiliser les API Power BI » dans le
portail d'administration Power BI. Une case à cocher, une fois.

Deux autres méritent d'être anticipés car ils ont un délai :

- **Quota Azure OpenAI** (TPM par déploiement) — attribué sur demande de support
  Microsoft. Terraform crée le déploiement mais ne peut pas relever le plafond.
- **Délégation NS de `solisbg.com`** vers Azure DNS — se fait chez le
  registrar. Alternative sans délégation : n'y créer qu'un CNAME et le TXT de
  validation exigés par Front Door.

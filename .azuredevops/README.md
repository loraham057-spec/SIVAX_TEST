# Pipelines Azure DevOps — cible AWS

Azure DevOps reste le système d'intégration continue ; ce qu'il déploie est
désormais AWS. Le dépôt vit sur GitHub, donc les commentaires de pull request,
les issues de dérive et les push de promotion passent par l'API GitHub avec un
PAT, exactement comme avant.

## Les six pipelines

| Fichier | Déclencheur | Ce qu'il fait |
|---|---|---|
| `pipelines/app-build.yml` | push `dev`/`prod`, PR | qualité, build des deux images, scan Trivy, push ECR, signature Cosign |
| `pipelines/k8s-deploy.yml` | fin de `app-build` | migrations, déplacement du tag dans l'overlay, réconciliation Flux, promotion dev→prod |
| `pipelines/iac-plan.yml` | PR touchant `infra/aws` | fmt, validate, plan, tflint, checkov, commentaire de PR |
| `pipelines/iac-apply.yml` | push `dev`/`prod` sur `infra/aws` | `terraform apply` de l'environnement de la branche |
| `pipelines/iac-drift.yml` | tous les jours à 06:00 | `plan -detailed-exitcode`, ouvre une issue GitHub si l'état a dérivé |
| `pipelines/k8s-validate.yml` | PR touchant `infra/k8s` | `kustomize build` + `kubeconform` sur chaque overlay |

## Ce qui a changé en venant d'Azure

**Authentification.** Il n'y a plus de service connection ARM ni de tâche
`AzureCLI@2`. Chaque job charge des identifiants AWS depuis les variables
secrètes de son variable group (`templates/steps-aws-login.yml`). Azure
Pipelines n'expose pas une variable secrète à un script automatiquement : c'est
le bloc `env:` de chaque étape qui la fait passer — d'où leur répétition, qui
est délibérée et non un oubli de factorisation.

À préférer dès que l'organisation peut installer une extension : l'« AWS Toolkit
for Azure DevOps » fournit une service connection qui assume un rôle par OIDC,
et les deux clés longue durée disparaissent. La structure des pipelines ne
changerait pas.

**Accès au cluster.** `az aks command invoke` n'a pas d'équivalent EKS. L'agent
parle directement au serveur d'API après `aws eks update-kubeconfig`. Deux
conséquences : le point de terminaison public doit rester joignable depuis
l'agent (`eks_api_allowed_cidrs` côté Terraform), et le principal du pipeline a
besoin d'une entrée d'accès EKS — Terraform la crée pour
`deployer_principal_arn`.

Effet de bord bienvenu : le code de sortie de `kubectl` est de nouveau celui de
l'étape. Le piège d'`az aks command invoke`, qui renvoyait 0 même quand la
commande exécutée dans le cluster échouait — et faisait passer une migration en
échec pour un succès — disparaît avec la traduction.

**Registre.** Un dépôt ECR par image, dont l'URL complète est portée par
`ECR_REPO_WEB` / `ECR_REPO_AI`. Le cache de build vit dans le dépôt lui-même
sous le tag `buildcache`, avec `image-manifest=true` — sans quoi ECR refuse le
manifeste que produit buildkit.

**Signature.** Cosign signe avec une clé asymétrique KMS (`awskms://`) au lieu
d'une clé Key Vault. L'étape est sautée tant que `COSIGN_KEY_ARN` est vide.

## Variable groups

Un par environnement : `diav1-dev-aws` et `diav1-prod-aws`.

| Variable | Secrète | Contenu |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | oui | identifiants du principal de déploiement |
| `AWS_REGION` | non | `eu-west-3` en dev, `eu-north-1` en prod |
| `ECR_REGISTRY` | non | `<compte>.dkr.ecr.<région>.amazonaws.com` |
| `ECR_REPO_WEB`, `ECR_REPO_AI` | non | URL complètes, sorties `ecr_repository_urls` |
| `EKS_CLUSTER` | non | sortie `cluster_name` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY` | non | injectés au build de l'image |
| `OPENAI_API_KEY`, `DHIS2_PASSWORD`, `RESEND_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` | oui | vont du groupe directement dans Secrets Manager |
| `GITHUB_TOKEN` | oui | PAT : commentaires de PR, issues de dérive, push de promotion, clone Flux |
| `COSIGN_KEY_ARN` | non | vide = pas de signature |
| `RUN_DB_MIGRATIONS` | non | `true` le jour où RDS portera le schéma applicatif |

Les valeurs non secrètes se lisent toutes dans `terraform output` de
l'environnement.

## Environnements Azure DevOps

`dev` et `prod`, le second avec un approbateur obligatoire. C'est cette
approbation qui sépare un merge d'un changement en production — les pipelines
n'ont pas d'autre garde-fou sur prod.

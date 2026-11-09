# Infrastructure AWS

Portage complet de la pile Terraform d'Azure vers AWS. Le contrat est le même
qu'en `infra/` : un module `stack` composé par un répertoire d'environnement
mince, un état par environnement, le même code pour dev et prod, seuls le
dimensionnement et les interrupteurs de sûreté changeant.

```
infra/aws/
  bootstrap/            bucket d'état S3 + table de verrous (état local, à dessein)
  modules/
    naming/             noms et tags — source unique
    network/            VPC, sous-réseaux, NAT (IP de sortie fixe), EIP d'ingress
    identity/           rôles IAM des charges de travail (IRSA) + rôle du pipeline
    runtime-eks/        cluster EKS, groupes de nœuds, add-ons, KEDA, CSI secrets
    gitops/             amorçage de Flux (chart flux2 + flux2-sync)
    ecr/                registre d'images
    s3-assets/          actifs statiques, exports, artefacts ML
    rds/                PostgreSQL managé, sans adresse publique
    elasticache/        Redis managé (facultatif)
    secrets/            AWS Secrets Manager + clé KMS
    observability/      journaux, alarmes, budget
    bedrock/            accès aux modèles de langage managés
    cloudfront/         CDN, WAF, TLS
    governance/         garde-fous de compte et détection
    image-builder/      projets CodeBuild : construire les images dans AWS
    stack/              composition d'un environnement
  envs/dev, envs/prod   enveloppes minces + tfvars + backend
```

## Correspondance Azure → AWS

| Azure | AWS | Note |
| --- | --- | --- |
| Resource group | tags + préfixe de nom | AWS n'a pas d'équivalent ; la ventilation de coût passe par le tag `env` |
| VNet, sous-réseaux délégués | VPC, sous-réseaux publics / privés / données | l'isolation des données vient de l'absence de route, pas d'une case |
| NAT Gateway + IP publique | NAT Gateway + EIP | même propriété : une adresse de sortie fixe pour l'allow-list SNIS RDC |
| IP publique d'ingress | EIP pré-allouées, adoptées par le NLB | l'adresse d'entrée est connue au plan |
| NSG | groupe de sécurité du cluster + liste de préfixes CloudFront | même défense à deux niveaux |
| Private endpoints + zones DNS privées | points de terminaison de VPC (`enable_interface_endpoints`) | activés en prod, coupés en dev pour le coût |
| Managed identities + Workload Identity | rôles IAM + IRSA | les noms de ServiceAccount restent porteurs |
| AKS | EKS | KEDA, metrics-server et l'autoscaler sont installés explicitement (intégrés côté AKS) |
| Extension microsoft.flux | charts `flux2` + `flux2-sync` | la substitution passe par un ConfigMap au lieu de Terraform |
| ACR | ECR | analyse d'image à la poussée incluse |
| Key Vault | Secrets Manager (+ KMS) | mêmes noms de secrets, préfixés `diav1/<env>/` |
| PostgreSQL Flexible Server | RDS PostgreSQL | authentification IAM à la place de l'administrateur Entra |
| Azure Cache for Redis | ElastiCache (facultatif) | par défaut, Redis tourne dans le cluster |
| Azure OpenAI | Bedrock (facultatif) | rien à provisionner : une politique IAM ; l'accès aux modèles se demande dans la console |
| Front Door + WAF | CloudFront + WAFv2 | `X-Origin-Verify` remplace `X-Azure-FDID` |
| Log Analytics + App Insights | CloudWatch Logs + alarmes | l'alarme de fraîcheur ETL fonctionne dès le premier apply |
| Consumption budget | AWS Budgets | en USD |
| Azure Policy, verrous | blocage public S3 du compte, `deletion_protection`, fenêtre de récupération | une SCP serait l'équivalent exact, mais elle s'écrit au niveau de l'organisation |

Ce qui n'a **pas** été porté : `runtime-aca` (Container Apps). Son équivalent
serait ECS Fargate. La variable `orchestrator` disparaît donc : les deux
environnements tournaient déjà sur Kubernetes, et livrer un seul runtime bien
tenu vaut mieux que deux à moitié.

## Déploiement

Prérequis sur l'agent : Terraform 1.9.8 (`infra/.terraform-version`), l'AWS CLI
(les fournisseurs Kubernetes et Helm s'authentifient par `aws eks get-token`),
et des identifiants AWS dans l'environnement.

```bash
# 1. Le backend d'état, une seule fois par compte.
cd infra/aws/bootstrap
terraform init && terraform apply

# 2. Un environnement.
cd ../envs/dev
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

Les fournisseurs Kubernetes et Helm sont configurés à partir de sorties du
module `stack` : au premier plan, ces valeurs sont inconnues et Terraform
diffère les ressources concernées, ce qui est le comportement voulu. La
contrepartie connue de ce motif est la destruction — retirer le cluster et les
releases Helm dans le même apply peut échouer, le fournisseur ne pouvant plus
joindre une API qui n'existe déjà plus. Détruire alors les releases d'abord
(`terraform destroy -target=module.stack.module.gitops`), puis le reste.

Les secrets arrivent en `TF_VAR_*` et ne doivent jamais être écrits dans un
fichier tfvars :
`TF_VAR_openai_api_key`, `TF_VAR_dhis2_password`, `TF_VAR_resend_api_key`,
`TF_VAR_elevenlabs_api_key`, `TF_VAR_supabase_service_role_key`,
`TF_VAR_vapid_private_key`, `TF_VAR_gitops_https_token`.

### Le DNS se fait en deux temps, et ce n'est pas contournable

CloudFront refuse une adresse IP comme origine. L'ordre est donc :

1. premier apply avec `enable_cdn = false` ;
2. `terraform output ingress_ips` → créer les enregistrements A de
   `ingress_hostname` (`origin-dev.sivax.health`) vers ces adresses ;
3. passer `enable_cdn = true`, appliquer, puis créer le CNAME du nom public
   vers le bord et les enregistrements de validation du certificat rendus par
   `terraform output dns_records` ;
4. une fois le certificat de l'ingress émis par cert-manager, basculer
   `cdn_origin_protocol_policy` sur `https-only`.

La validation de la variable `enable_cdn` refuse l'apply si
`ingress_hostname` est vide — le diagnostic arrive avant l'apply plutôt
qu'après, quand tout paraît sain sauf le trafic.

### Clé de déploiement Flux

Le premier apply engendre une paire ED25519 ; `terraform output
gitops_deploy_public_key` en donne la moitié publique, à déclarer dans le dépôt
(Settings → Deploy keys, lecture seule). Fournir `TF_VAR_gitops_https_token`
évite ce geste : l'amorçage devient entièrement reproductible.

## Les manifests et les pipelines suivent

Le portage ne s'arrete pas a Terraform : `infra/k8s/` et `.azuredevops/` ont ete
convertis dans le meme mouvement, sans quoi la plateforme se construirait mais
l'application ne se deploierait pas.

**Manifests (`infra/k8s/`).** Les ServiceAccount portent un role IRSA
(`eks.amazonaws.com/role-arn`) au lieu d'un clientID Entra, et le label
`azure.workload.identity/use` disparait : le webhook d'EKS injecte le jeton des
que l'annotation est presente. Les trois SecretProviderClass fusionnent en une
seule — le fournisseur AWS prend l'identite du pod qui monte, la ou le
fournisseur Azure exigeait de nommer l'identite autorisee dans la classe. Le
collecteur OpenTelemetry exporte vers X-Ray et CloudWatch. L'ingress verifie
`X-Origin-Verify` au lieu de `X-Azure-FDID`. Le NLB adopte les EIP
pre-allouees.

Une suppression merite d'etre signalee : la reecriture CoreDNS
(`coredns-hairpin.yaml`) etait indispensable sur AKS, ou Azure Load Balancer ne
supporte pas le hairpin et bloquait l'auto-verification de cert-manager. Sur
AWS les noeuds sont dans des sous-reseaux prives et sortent par la NAT : le NLB
voit l'adresse de la NAT, pas celle d'une cible enregistree, et la restriction
ne s'applique pas. Le fichier n'a donc pas ete traduit, il a ete retire —
`platform-issuers/cluster-issuer.yaml` porte le raisonnement complet.

**Pipelines (`.azuredevops/`).** Azure DevOps reste le systeme d'integration
continue et deploie AWS. Voir `.azuredevops/README.md` pour les variable groups
a creer et les deux consequences structurelles de l'absence d'equivalent
d'`az aks command invoke`.

## Construire les images sans poste de travail

Deux chemins, et le second existe pour une raison precise.


`modules/image-builder` provisionne un projet CodeBuild par image, dont la
source est un objet S3. `scripts/aws-build-images.sh <env>` fabrique l'archive
avec `git archive` (donc uniquement ce qui est suivi par git : ni node_modules,
ni `.env.local`, ni etat Terraform), la depose et lance les deux builds.

```bash
./scripts/aws-build-images.sh dev
```

Sur un compte AWS recent, ce chemin peut etre ferme : TOUS les quotas de builds
concurrents CodeBuild valent zero jusqu'a ce qu'une demande d'augmentation soit
accordee, et `StartBuild` echoue alors sur « Cannot have more than 0 builds in
queue for the account ». Le compte est sain, le projet correct, et rien ne
demarre. C'est ce qui s'est produit au premier amorcage de dev.

Le repli ne demande aucun quota :

```bash
./scripts/aws-build-images-incluster.sh dev
```

Kaniko construit dans un pod du cluster, sans demon Docker ni privileges, lit la
meme archive de source dans S3 et pousse dans les memes depots ECR. Le pod porte
un role IRSA cree par le meme module, donc aucun identifiant n'est monte.

Aucun des deux n'est le chemin normal — le pipeline l'est, avec ses tests et son
scan Trivy. Ce sont des chemins d'amorcage : monter un environnement neuf ne
depend alors ni d'une machine de developpeur, ni d'une organisation CI deja
configuree, ni d'un quota qu'on ne controle pas.

## Le serveur d'API est public mais restreint, y compris en prod

Decision, pas relachement. EKS n'a pas d'equivalent d'`az aks command invoke` :
avec un point de terminaison prive, ni Terraform — qui installe Flux par les
fournisseurs helm et kubernetes — ni le pipeline de deploiement ne peuvent
joindre le cluster depuis l'exterieur du VPC. Un cluster reellement prive
suppose donc un agent auto-heberge dans le VPC, ce qui est le pas suivant.

En attendant, la surface est reduite par `eks_api_allowed_cidrs` (tfvars)
plutot que par l'absence d'adresse, et toute requete reste authentifiee par IAM
puis autorisee par une entree d'acces EKS. La liste d'adresses est une seconde
barriere, pas la seule.

## Ce que ce compte AWS refuse, et ce qu'on a mis a la place

Un compte AWS recent porte des restrictions qui ne se decouvrent qu'a
l'execution. Les trois rencontrees en montant cette plateforme, avec le
contournement retenu :

**Les Network Load Balancers sont refuses.** `elbv2 create-load-balancer`
repond « OperationNotPermitted: This AWS account currently does not support
creating load balancers ». Verifie a l'appel direct des trois APIs : le refus
ne vise QUE les NLB — les Classic et les ALB passent. Le Service d'ingress
restait donc `<pending>` indefiniment, cluster parfaitement sain.

`ingress_lb_type` porte ce choix. Sur `clb`, l'entree est un nom DNS et non les
IP elastiques pre-allouees, qui restent allouees sans etre utilisees. Repasser
a `nlb` des que la restriction est levee est un changement d'une ligne.

**CodeBuild ne peut lancer aucun build.** Tous les quotas de builds concurrents
valent zero jusqu'a une demande d'augmentation : `StartBuild` echoue sur
« Cannot have more than 0 builds in queue for the account ». D'ou le second
chemin de construction, dans le cluster (voir plus haut).

**Le compte root ne peut pas administrer Kubernetes.** EKS refuse toute entree
d'acces pour ce principal, donc l'onglet « Ressources » de la console repond
« Unauthorized » — alors que kubectl fonctionne depuis un poste. Le module
runtime-eks cree pour cela un role endossable :

```bash
terraform output -raw eks_console_role_arn
# arn:aws:iam::<compte>:role/diav1-<env>-eks-console
```

Dans la console : menu du compte → « Changer de role » → coller cet ARN. La
navigation se fait alors sous une identite que EKS sait reconnaitre. Le role
porte les droits d'administration du cluster ; pour de la lecture seule,
remplacer AmazonEKSClusterAdminPolicy par AmazonEKSAdminViewPolicy dans
`modules/runtime-eks/main.tf`.

## L'adresse depuis laquelle on administre est dans le code

`eks_api_allowed_cidrs` (tfvars) est ce qui autorise kubectl et les
fournisseurs Kubernetes de Terraform a joindre le serveur d'API. Cette adresse
change toute seule chez la plupart des fournisseurs d'acces.

Le jour ou elle change, kubectl ne dit pas « refuse » mais **« TLS handshake
timeout »** — ce qui ressemble a un cluster en panne alors que tout va bien,
application servie comprise. Relever l'adresse courante et l'ajouter :

```bash
curl https://checkip.amazonaws.com
```

Le debloquer immediatement sans attendre un apply :

```bash
aws eks update-cluster-config --name <cluster> --region <region>   --resources-vpc-config "endpointPublicAccess=true,endpointPrivateAccess=true,publicAccessCidrs=<ip>/32"
```

...puis reporter la valeur dans les tfvars, sinon le prochain apply la retire.

## L'arbre Azure reste en place

`infra/modules/` et `infra/envs/` ne sont pas supprimés : leur état pointe sur
des ressources vivantes, et effacer le code retirerait le seul moyen de les
détruire proprement. À supprimer après un `terraform destroy` des deux
environnements Azure, une fois la bascule faite et vérifiée.

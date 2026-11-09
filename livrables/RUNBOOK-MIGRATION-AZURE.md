# Runbook — Redéployer SIVAX dans un autre compte Azure

> Compagnon de `RUNBOOK-MISE-A-JOUR.md`, qui décrit les mises à jour du jour le
> jour. Celui-ci décrit la **reconstruction complète de la plateforme dans un
> abonnement Azure neuf** : ce qu'il faut décider avant, ce qui change dans le
> dépôt, dans quel ordre appliquer, et comment démanteler l'ancien.

---

## 0. Ce que « redéployer ailleurs » veut dire ici

Rien n'est déplacé. **Tout est reconstruit** par Terraform dans le nouvel
abonnement, à partir du même code. Il n'y a pas de migration d'état Terraform à
faire : les identifiants de ressources Azure contiennent l'abonnement, aucun
objet de l'ancien état n'est réutilisable. On repart d'un état vide.

Deux questions décident du reste du runbook :

| Question | Conséquence |
| --- | --- |
| **Même tenant Entra, ou nouveau tenant ?** | Nouveau tenant ⇒ nouvelle app registration, service connections Azure DevOps en fédération *manuelle*, `aks_admin_group_object_ids` à refaire. Même tenant ⇒ seuls l'abonnement et les rôles changent. |
| **dev + prod, ou prod seule ?** | Chaque environnement est un répertoire `infra/envs/<env>` avec son propre state ; les étapes 4 → 9 se répètent à l'identique par environnement. |

Le reste de la chaîne ne bouge pas : l'organisation Azure DevOps, le dépôt
GitHub (que Flux réconcilie), Supabase, Resend, ElevenLabs, OpenAI, SNIS RDC.

### Ce qui bouge / ce qui ne bouge pas

| Élément | Statut |
| --- | --- |
| Groupes de ressources, VNet, AKS, PostgreSQL, Key Vault, ACR, Storage, Log Analytics | **Recréés** par Terraform |
| Noms globalement uniques (`kv-…`, `st…`, `acr…`) | **Changent automatiquement** — le suffixe de 4 caractères dérive de `subscription_id` (`infra/modules/naming/main.tf`) |
| Compte de stockage du tfstate (`stdiav1tfstate`) | **Nom déjà pris** dans l'ancien abonnement → à renommer (§3.1) |
| Serveur PostgreSQL (`psql-diav1-<env>-<région>`) | Nom **globalement unique** lui aussi ; le suffixe a été ajouté au module `naming` pendant cette migration (§Annexe B) |
| Images de conteneurs | **À reconstruire** : le nouvel ACR est vide |
| Base PostgreSQL | **Vide** → migrations + ETL complet (§8) |
| Supabase (users, notifications, ETL phase 1) | **Inchangé** si on garde le même projet ; sinon rejouer `supabase/migrations/` |
| IP publique d'ingress + IP de sortie (NAT) | **Nouvelles** → DNS à repointer, liste blanche SNIS à mettre à jour (§7) |
| Clé de déploiement Flux | **Nouvelle paire par cluster** → à déclarer sur GitHub (§7) |
| Secrets tiers (OpenAI, DHIS2, Resend, ElevenLabs, Supabase, VAPID) | **Réutilisés**, re-saisis dans les variable groups |
| Mots de passe PostgreSQL, `PUSH_INTERNAL_TOKEN` | **Régénérés** par Terraform (`random_password`) |

---

## 1. Prérequis de l'opérateur

Sur le **nouvel** abonnement / tenant :

| Portée | Rôle |
| --- | --- |
| Tenant Entra | Application Administrator (ou Cloud Application Administrator) |
| Abonnement | Owner, ou Contributor + User Access Administrator |

Ces droits ne servent qu'à l'amorçage (§3). Le service principal créé ensuite
reçoit délibérément moins : `Contributor` + `Role Based Access Control
Administrator`, jamais `Owner`.

Outils : `az` CLI, `terraform` (voir `infra/.terraform-version`), `git`, `jq`.

---

## 2. Vérifier le nouvel abonnement AVANT tout apply

C'est l'étape qui évite les deux jours perdus. Trois choses tuent un premier
apply dans un abonnement neuf : les **resource providers** non enregistrés, les
**quotas à zéro**, et une **région qui refuse les nouveaux clients**.

```bash
az login
az account set --subscription <NOUVEAU_SUBSCRIPTION_ID>
az account show -o table
```

### 2.1 Enregistrer les resource providers

```bash
for ns in Microsoft.ContainerService Microsoft.KubernetesConfiguration \
          Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL \
          Microsoft.KeyVault Microsoft.Storage Microsoft.Network \
          Microsoft.ManagedIdentity Microsoft.OperationalInsights \
          Microsoft.Insights Microsoft.Authorization Microsoft.PolicyInsights \
          Microsoft.CostManagement Microsoft.Cdn Microsoft.CognitiveServices; do
  az provider register --namespace "$ns"
done
az provider list --query "[?registrationState!='Registered'].namespace" -o tsv
```

`Microsoft.KubernetesConfiguration` est celui qu'on oublie : sans lui,
l'extension Flux (`azurerm_kubernetes_cluster_extension.flux`) échoue et le
cluster ne réconcilie rien.

### 2.2 Quotas de calcul

L'infra actuelle demande, par environnement : 2 nœuds `Standard_D2s_v6`
(4 vCPU), plus la marge de 33 % d'un upgrade. Les abonnements neufs partent
souvent à 0 sur les familles récentes.

```bash
az vm list-usage --location francecentral -o table | grep -Ei "Total Regional|DSv6|Dsv5"
az vm list-usage --location swedencentral  -o table | grep -Ei "Total Regional|DSv6|Dsv5"
```

Il faut au minimum **10 vCPU régionaux** et **10 vCPU sur la famille Dsv6** par
région utilisée. Sinon : demande de quota au support (délai de quelques heures
à deux jours), ou repli sur `Standard_D2s_v5` en changeant
`aks_system_node_vm_size` / `aks_user_node_vm_size` dans `infra/envs/*/main.tf`.

### 2.3 Disponibilités régionales

Le choix actuel — `francecentral` pour dev, `swedencentral` pour prod — vient
de contraintes de l'ancien abonnement (voir les commentaires en tête des
`terraform.tfvars`). À revalider sur le nouveau :

```bash
az storage account check-name --name sttestdiav1x --query nameAvailable
az aks get-versions -l francecentral -o table
az postgres flexible-server list-skus -l francecentral -o table | grep -i "B1ms\|B2s"
```

### 2.4 Quotas restés à zéro sur l'ancien abonnement

Deux services sont **désactivés dans le code** parce que l'ancien abonnement ne
les autorisait pas. Le nouveau les autorise peut-être ; ce n'est pas un
prérequis, c'est une occasion :

- **Front Door** — `enable_frontdoor = false` dans les deux tfvars (quota de
  profils à 0). Le remettre à `true` rétablit WAF, cache et TLS géré au bord.
- **Azure OpenAI** — `enable_openai = false` ; l'application utilise l'API
  OpenAI publique via le secret `openai-api-key`.

```bash
az cognitiveservices usage list -l francecentral -o table
```

Laisser ces deux drapeaux à `false` pour la première mise en service : on
valide d'abord une bascule à périmètre constant, on améliore ensuite.

---

## 3. Amorçage — la seule étape hors Terraform

`infra/bootstrap/bootstrap.sh` s'exécute **une fois par abonnement**. Il crée
le compte de stockage du state, le service principal Terraform, la fédération
OIDC GitHub et les attributions de rôles.

### 3.1 Le piège du nom de stockage

Le script compose `SA_TF="st${PROJECT}tfstate"` → `stdiav1tfstate`, un nom
**globalement unique déjà pris** par l'ancien abonnement. Deux issues :

- l'ancien abonnement est conservé le temps de la bascule → **il faut un autre
  nom** ;
- l'ancien est supprimé d'abord → le nom se libère, mais on se prive de tout
  retour arrière.

Choisir un préfixe d'amorçage distinct, qui ne nomme **que** les ressources du
state (le slug applicatif reste `diav1`, il vient des tfvars) :

```bash
cd infra/bootstrap
export AZURE_SUBSCRIPTION_ID=<NOUVEAU_SUBSCRIPTION_ID>
export PROJECT=diav1x
export AZURE_LOCATION=francecentral
export GH_ORG=<org> GH_REPO=<repo>

./bootstrap.sh --dry-run
./bootstrap.sh
```

→ `rg-diav1x-tfstate` / `stdiav1xtfstate` / `sp-diav1x-terraform`.

Le script est idempotent. Il affiche en sortie `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — trois GUID, pas des secrets.

### 3.2 Si la CI reste sur Azure DevOps

La fédération OIDC créée par le script vise GitHub Actions, qui **ne lance plus
rien** ici (voir `.github/README.md`). Elle est inoffensive, mais l'identité
qui compte est celle des service connections Azure DevOps — voir §5. Le script
reste nécessaire pour le **compte de stockage du state** et pour disposer d'une
identité utilisable en local lors du premier apply.

---

## 4. Modifier le dépôt

Toutes les valeurs liées à l'abonnement vivent dans quatre endroits. Travailler
sur une branche, puis fusionner dans `dev` (la branche = l'environnement).

```bash
git checkout dev && git pull && git checkout -b chore/migration-azure
```

### 4.1 `infra/envs/dev/backend.hcl` et `infra/envs/prod/backend.hcl`

```hcl
resource_group_name  = "rg-diav1x-tfstate"
storage_account_name = "stdiav1xtfstate"
container_name       = "tfstate"
key                  = "dev.terraform.tfstate"   # prod.terraform.tfstate côté prod
```

### 4.2 `infra/envs/dev/terraform.tfvars` et `infra/envs/prod/terraform.tfvars`

| Clé | Action |
| --- | --- |
| `subscription_id` | **le nouveau GUID** |
| `location` / `openai_location` | confirmer ou changer selon §2.3 |
| `key_vault_allowed_ips` | l'IP publique **depuis laquelle Terraform sera lancé** (§6.2) |
| `custom_domain` | **ne jamais vider** : `patch-ingress-tls.yaml` pose un bloc `tls` inconditionnel et un host vide fait rejeter l'Ingress. Le laisser renseigné dès le premier apply ; cert-manager échouera son challenge sans rien casser jusqu'à la bascule DNS |
| `supabase_url` | inchangé si le projet Supabase est conservé |
| `enable_frontdoor` | `true` seulement si §2.4 confirme le quota |
| `alert_emails`, `acme_email` | à renseigner tant qu'à faire |

### 4.3 `infra/envs/*/main.tf`

- `aks_system_node_vm_size` / `aks_user_node_vm_size` si le quota impose un
  repli (§2.2) ;
- `aks_admin_group_object_ids` si un groupe Entra du **nouveau** tenant doit
  avoir cluster-admin ;
- `gitops_repository_url` (variable du module `stack`, défaut
  `https://github.com/fidelensadi/tbi_pfizer.git`) **si le dépôt change**.

### 4.4 `scripts/acr-build.py`

Ses valeurs par défaut pointent l'ancien abonnement (lignes 157-159 :
`--registry acrdiav1dev2d24`, `--resource-group rg-diav1-dev-frc`,
`--subscription acf4a7fb-…`). Les mettre à jour après le premier apply, quand
les nouveaux noms sont connus — ou toujours passer les trois options
explicitement.

> `infra/.env` contient des identifiants de l'ancien abonnement. Ne pas le
> recopier tel quel : les valeurs `ARM_*` y sont périmées après la bascule.

---

## 5. Identité de la CI — Azure DevOps

### 5.1 Service connections

Créer deux service connections **Azure Resource Manager / Workload Identity
Federation**, nommées exactement comme les pipelines les référencent
(`azure-<environnement>`) :

| Nom | Abonnement |
| --- | --- |
| `azure-dev` | nouveau |
| `azure-prod` | nouveau |

*Même tenant* : la création automatique depuis l'interface Azure DevOps suffit.
*Nouveau tenant* : passer par **Workload identity federation (manual)** — créer
l'app registration dans le nouveau tenant, y ajouter un federated credential
avec l'*issuer* et le *subject* affichés par Azure DevOps, puis renseigner
`Issuer` / `Subject identifier` côté service connection.

### 5.2 Rôles à donner à chaque identité fédérée

Sur l'abonnement (ou, plus étroitement, sur le groupe de ressources une fois
créé) :

- **Contributor** ;
- **Role Based Access Control Administrator** (Terraform crée des attributions
  de rôles : AcrPull, Key Vault Secrets User…) ;
- **Storage Blob Data Contributor** sur `stdiav1xtfstate` — le compte de state
  a `allow_shared_key_access = false`, tout passe par Entra ;
- sur le cluster, une fois créé : **Azure Kubernetes Service RBAC Writer** et
  **Azure Kubernetes Service Cluster User Role** (ce dernier porte
  `managedClusters/runcommand/action`, dont dépend `az aks command invoke`).
  Terraform les pose déjà pour le principal qui exécute l'apply
  (`deployer_principal_id`) — à vérifier si apply et déploiement tournent sous
  des identités différentes.

### 5.3 Environments et approbations

Pipelines → Environments : recréer `dev` et `prod`, avec un **Approvals** check
sur `prod`. C'est la seule barrière humaine de la chaîne d'auto-promotion
dev → prod.

### 5.4 Enregistrement des pipelines

Six pipelines pointant sur `.azuredevops/pipelines/`. **Nommer celui de
`app-build.yml` exactement `app-build`** : `k8s-deploy.yml` le référence par ce
nom dans `resources.pipelines.source`.

### 5.5 Parallélisme hébergé — le piège de facturation

**C'est le point qui casse la CI en silence, et il n'a rien à voir avec le
code.** La capacité d'exécution d'une organisation Azure DevOps est adossée à
un abonnement Azure. Changer d'abonnement rompt ce lien : les pipelines
échouent avant de démarrer, sur

```
No hosted parallelism has been purchased or granted.
```

Aucun job ne s'exécute, donc aucun message ne parle de Terraform, d'ACR ni
d'identité — le diagnostic part facilement dans la mauvaise direction.
Vérifier d'emblée :

```bash
curl -s -u :$ADO_PAT   "https://dev.azure.com/<org>/_apis/distributedtask/pools?api-version=7.1"
```

Trois issues, à trancher tôt car deux d'entre elles ont un délai :

1. **Rattacher la facturation au nouvel abonnement et acheter un job
   parallèle** — *Organization settings → Billing → Set up billing*, choisir le
   nouvel abonnement, puis porter *Paid parallel jobs* (Private) à 1. Environ
   40 $/mois, effectif en quelques minutes.
2. **Demander la subvention gratuite** pour projet privé — formulaire Microsoft,
   2 à 3 jours ouvrés, sans garantie.
3. **Agent auto-hébergé** — gratuit côté Azure DevOps, et c'est la seule option
   qui règle aussi le problème du §6.2 : un agent à IP fixe peut être ajouté à
   `key_vault_allowed_ips`, ce qui rend `iac-plan` et `iac-apply` exécutables
   depuis la CI. Avec des agents hébergés, ces deux pipelines restent voués à
   l'apply local.

---

## 6. Premier apply — dev

### 6.1 Variable groups Azure DevOps

Créer `diav1-dev` et `diav1-prod`. En clair :

```
AZURE_SUBSCRIPTION_ID   RESOURCE_GROUP     ACR_NAME       ACR_LOGIN_SERVER
SUPABASE_URL            SUPABASE_ANON_KEY  VAPID_PUBLIC_KEY
PUBLIC_URL              KEY_VAULT_NAME     ORCHESTRATOR   COSIGN_KEY_NAME
```

En secret :

```
OPENAI_API_KEY   DHIS2_PASSWORD   RESEND_API_KEY   ELEVENLABS_API_KEY
SUPABASE_SERVICE_ROLE_KEY   VAPID_PRIVATE_KEY   GITHUB_TOKEN
```

`RESOURCE_GROUP`, `ACR_NAME`, `ACR_LOGIN_SERVER`, `KEY_VAULT_NAME` ne sont
connus qu'**après** le premier apply (le suffixe unique dépend de
l'abonnement). Les laisser vides ici, les renseigner en §7.

### 6.2 Lancer le premier apply en local, pas dans la CI

Le pare-feu du Key Vault n'autorise que les adresses de
`key_vault_allowed_ips`. Les agents hébergés Azure DevOps ont des IP
dynamiques : un apply depuis la CI échoue sur l'écriture des secrets — c'est
exactement ce qui a conduit, sur l'ancien abonnement, à ouvrir puis refermer le
coffre à la main (commits `1b734e8` / `3c4b8b4`). Faire le premier apply depuis
un poste à IP connue, déclarée dans les tfvars.

```bash
cd infra/envs/dev
export ARM_USE_AZUREAD=true
export ARM_SUBSCRIPTION_ID=<NOUVEAU_SUBSCRIPTION_ID>
export TF_VAR_use_oidc=false

export TF_VAR_openai_api_key=…
export TF_VAR_dhis2_password=…
export TF_VAR_dhis2_username=…
export TF_VAR_resend_api_key=…
export TF_VAR_elevenlabs_api_key=…
export TF_VAR_supabase_service_role_key=…
export TF_VAR_supabase_anon_key=…
export TF_VAR_vapid_private_key=…
export TF_VAR_vapid_public_key=…

terraform init -reconfigure -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

`-reconfigure` (et non `-migrate-state`) : on veut un state **neuf**, pas une
copie de l'ancien.

Compter 25 à 45 minutes. Si l'apply s'arrête en cours de route, le relancer :
il est idempotent et reprend là où il en est.

### 6.3 Relevé des sorties

```bash
terraform output
terraform output -raw acr_login_server
terraform output -raw resource_group
terraform output -raw key_vault_name
terraform output -raw egress_ip
terraform output -raw public_url
terraform output -raw gitops_deploy_public_key
```

---

## 7. Après l'apply — les six branchements manuels

1. **Clé de déploiement Flux.** GitHub → dépôt → Settings → Deploy keys → *Add
   deploy key*, coller `gitops_deploy_public_key`, **lecture seule**, titre
   `flux-dev-<nouvel abonnement>`. Sans elle, Flux ne clone pas et **rien ne se
   déploie** — la source reste en erreur d'authentification.

2. **Variable groups.** Renseigner `RESOURCE_GROUP`, `ACR_NAME`,
   `ACR_LOGIN_SERVER`, `KEY_VAULT_NAME`, `AZURE_SUBSCRIPTION_ID`, `PUBLIC_URL`
   avec les sorties du §6.3.

3. **Liste blanche SNIS RDC — vérifier AVANT de la demander.** L'hypothèse
   coûte des jours d'attente pour rien : lors de cette migration, la nouvelle IP
   de sortie n'était pas filtrée du tout. Un appel depuis un pod tranche en
   trente secondes :

   ```bash
   kubectl -n diav1 exec <pod-ai> -c ai -- python -c "import os,urllib.request,base64;   t=base64.b64encode(f\"{os.environ['DHIS2_USERNAME']}:{os.environ['DHIS2_PASSWORD']}\".encode()).decode();   r=urllib.request.Request(os.environ['DHIS2_BASE_URL']+'/api/system/info',headers={'Authorization':'Basic '+t});   print(urllib.request.urlopen(r,timeout=25).status)"
   ```

   Une réponse HTTP, même `401`, prouve que le réseau passe : le problème est
   alors d'identifiants, pas de filtrage. Seul un timeout justifie de saisir le
   ministère.

4. **DNS.** Chez le registrar (Hostinger) : `dev.sivax.health` et
   `sivax.health` → nouvelle IP d'ingress. Voir §9 pour l'ordre.

5. **Quotas.** Si les demandes du §2.2 / §2.4 sont encore en cours, vérifier
   qu'elles ont abouti.

6. **Power BI**, si la fonctionnalité est utilisée : les variables
   `POWERBI_TENANT_ID` / `POWERBI_CLIENT_ID` / `POWERBI_CLIENT_SECRET`
   (`.env.example`) désignent une app registration du **tenant**, pas de
   l'abonnement. Nouveau tenant ⇒ nouvelle app registration, nouveau workspace,
   et la case « Autoriser les principaux de service à utiliser les API Power
   BI » à cocher dans le portail d'administration Power BI.

---

## 8. Première image et premier déploiement

Le nouvel ACR est vide, et les overlays référencent un tag (`sha-…`) qui n'y
existe pas. Rien ne démarrera tant qu'une image n'est pas poussée.

1. Fusionner la branche de migration dans `dev` et pousser. Cela déclenche
   `iac-apply` (plan vide ou presque) puis `app-build`.
2. Si `app-build` ne part pas — ses filtres de chemins ignorent `infra/` — le
   lancer à la main (Pipelines → *App — build* → Run, branche `dev`).
3. `k8s-deploy` enchaîne : job `db-migrate` sur la nouvelle image, puis avance
   du tag dans `infra/k8s/overlays/dev/kustomization.yaml`, que Flux réconcilie.
4. **Peupler la base.** La base PostgreSQL est vide ; l'ETL incrémental ne
   rattrape pas un historique inexistant. Lancer un ETL complet :

```bash
az aks command invoke -g <RESOURCE_GROUP> -n <CLUSTER> \
  -c "kubectl -n diav1 create job --from=cronjob/etl-full etl-full-bootstrap"
az aks command invoke -g <RESOURCE_GROUP> -n <CLUSTER> \
  -c "kubectl -n diav1 logs -f job/etl-full-bootstrap"
```

5. **Supabase.** Même projet conservé ⇒ rien à faire. Nouveau projet ⇒ rejouer
   `supabase/migrations/*.sql` dans l'ordre, puis mettre à jour `supabase_url`,
   `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` partout (tfvars + variable
   groups). Attention : `prod` réutilise volontairement le projet Supabase de
   `dev` (commentaire dans `infra/envs/prod/terraform.tfvars`).

### Vérifier

```bash
az aks command invoke -g <RG> -n <CLUSTER> -c "kubectl -n diav1 get pods,ingress"
az aks command invoke -g <RG> -n <CLUSTER> -c "kubectl -n flux-system get kustomizations"
curl -sI http://<INGRESS_IP>/api/health
```

Les `kustomizations` doivent être `Ready=True`. Une source en erreur
d'authentification = clé de déploiement manquante (§7.1).

---

## 9. Production

Répéter §4 → §8 pour `infra/envs/prod`, avec trois différences :

- `key` du backend = `prod.terraform.tfstate` ;
- le cluster prod est **privé** (`aks_private_cluster = true`) : tout passe par
  `az aks command invoke`, jamais par `kubectl` direct ;
- l'environnement Azure DevOps `prod` demande une approbation.

La promotion se fait par `git merge dev → prod` puis push (voir
`RUNBOOK-MISE-A-JOUR.md` §3). L'auto-promotion depuis `dev` fera le reste une
fois la chaîne validée.

### Bascule DNS, dans cet ordre

1. Valider la nouvelle prod **par IP** (`http://<INGRESS_IP>`), pendant que
   l'ancienne sert encore le domaine.
2. Abaisser le TTL de `sivax.health` à 300 s, 24 h avant.
3. Repointer l'enregistrement A vers la nouvelle IP d'ingress.
4. cert-manager ne peut obtenir le certificat Let's Encrypt (challenge HTTP-01)
   qu'**après** que le DNS pointe sur le nouvel ingress : compter quelques
   minutes de HTTP nu, puis vérifier :

```bash
az aks command invoke -g <RG> -n <CLUSTER> -c "kubectl -n diav1 get certificate"
curl -sI https://sivax.health
```

5. Remonter le TTL une fois la bascule stable.

Avant la bascule, l'environnement se valide en forçant la résolution plutôt
qu'en visant l'IP nue — l'Ingress ne répond que sur son host :

```bash
curl -sk --resolve sivax.health:443:<INGRESS_IP> https://sivax.health/api/health
```

Alternative sans coupure : renseigner d'abord
`custom_domain = "new.sivax.health"`, valider certificat compris, puis basculer
le nom définitif.

---

## 10. Démanteler l'ancien abonnement

**Seulement après** une journée pleine de fonctionnement sur le nouveau, et
après avoir vérifié qu'une sauvegarde des données utiles existe (Supabase est
externe ; PostgreSQL est reconstructible par l'ETL).

```bash
cd infra/envs/prod && terraform init -reconfigure -backend-config=backend.hcl && terraform destroy
cd ../dev && terraform init -reconfigure -backend-config=backend.hcl && terraform destroy
```

Couper d'abord l'auto-promotion : désactiver les pipelines visant l'ancien
abonnement, ou retirer leurs service connections — sinon un push sur `dev`
redéploie ce qu'on est en train de détruire.

Puis, à la main :

- retirer les **deploy keys** de l'ancien Flux sur GitHub ;
- supprimer `rg-diav1-tfstate` / `stdiav1tfstate` ;
- supprimer le service principal `sp-diav1-terraform` et ses federated
  credentials ;
- retirer l'ancienne IP de sortie de la liste blanche SNIS ;
- annuler l'abonnement.

Aucun lock ni purge protection n'est actif (`enable_deletion_locks = false`,
`key_vault_purge_protection = false` dans `infra/envs/prod/main.tf`) : le
`destroy` passe sans intervention.

> Garder les deux abonnements en parallèle une semaine coûte quelques centaines
> d'euros (voir `RUNBOOK-MISE-A-JOUR.md` §6) — c'est le prix d'un retour arrière
> immédiat.

---

## Annexe A — Checklist

```
Préparation
[ ] Abonnement/tenant cible identifiés, droits Owner + Application Administrator
[ ] Resource providers enregistrés
[ ] Quotas vCPU vérifiés (>=10 régionaux, >=10 Dsv6) par région
[ ] Régions validées (storage, AKS 1.34, PostgreSQL B1ms/B2s)
[ ] Demande de quota Front Door / OpenAI si on veut les réactiver

Amorçage
[ ] bootstrap.sh exécuté avec un PROJECT distinct (nom de storage libre)
[ ] AZURE_CLIENT_ID / TENANT_ID / SUBSCRIPTION_ID relevés

Dépôt
[ ] backend.hcl dev + prod mis à jour
[ ] terraform.tfvars dev + prod : subscription_id, location, key_vault_allowed_ips
[ ] main.tf : tailles de nœuds, groupes admin, gitops_repository_url
[ ] scripts/acr-build.py : valeurs par défaut

Azure DevOps
[ ] Service connections azure-dev / azure-prod (WIF)
[ ] Rôles Contributor + RBAC Admin + Storage Blob Data Contributor
[ ] Environments dev / prod, approbation sur prod
[ ] Six pipelines enregistrés, celui de app-build.yml nommé "app-build"
[ ] Variable groups diav1-dev / diav1-prod (secrets)

Apply
[ ] terraform apply dev réussi
[ ] Deploy key Flux ajoutée sur GitHub (lecture seule)
[ ] Variable groups complétés avec RESOURCE_GROUP / ACR_* / KEY_VAULT_NAME
[ ] app-build + k8s-deploy passés, pods Running
[ ] ETL complet lancé, données présentes
[ ] Idem prod

Bascule
[ ] Nouvelle IP de sortie déclarée au SNIS
[ ] TTL abaissé puis DNS repointé
[ ] Certificat Let's Encrypt émis, https OK
[ ] Anciennes ressources détruites
```

## Annexe B — Pièges déjà rencontrés

| Symptôme | Cause | Remède |
| --- | --- | --- |
| `storage account name already taken` à l'amorçage | `stdiav1tfstate` existe dans l'ancien abonnement | `PROJECT=diav1x` (§3.1) |
| Apply CI qui échoue sur `azurerm_key_vault_secret` | Pare-feu du coffre : IP de l'agent non listée | Premier apply en local depuis une IP déclarée (§6.2) |
| `Extension microsoft.flux not found` | `Microsoft.KubernetesConfiguration` non enregistré | §2.1 |
| Pods `ImagePullBackOff` | ACR vide, tag inexistant | Lancer `app-build` (§8.2) |
| Flux en erreur d'authentification sur la source | Deploy key non déclarée sur GitHub | §7.1 |
| Aucun indicateur dans l'application | Base vide, ETL jamais joué en complet | §8.4 |
| Certificat en `False`, ordre ACME bloqué | DNS pas encore sur le nouvel ingress | §9 — HTTP-01 exige le DNS d'abord |
| `the number of profiles created exceeds quota` | Front Door à 0 sur l'abonnement | `enable_frontdoor = false` |
| `No hosted parallelism has been purchased or granted` | La facturation de l'organisation Azure DevOps était liée à l'ancien abonnement | §5.5 |
| Job ETL indéfiniment `Pending` | Il demandait 500 m de CPU ; aucun nœud n'avait autant de libre | Requête ramenée à 200 m — la charge est bornée par les appels DHIS2, pas par le CPU |
| DHIS2 répond `401` | Les overlays configuraient le compte `diav1`, le coffre portait le mot de passe de `Berly_Lora` | Aligner `DHIS2_USERNAME` sur le compte dont le mot de passe est réellement stocké |
| Ingress qui répond 404 sur l'IP nue | Normal : la règle porte un `host` | Tester avec `curl --resolve <host>:443:<ip>` |
| Certificat bloqué après correction du DNS | cert-manager compte l'échec sur la ressource `Certificate` et impose un backoff d'une heure | `kubectl delete certificate <nom>` : l'ingress-shim la recrée sans historique |
| `ServerNameAlreadyExists` sur PostgreSQL | Le nom du serveur est globalement unique et l'ancien abonnement l'occupe encore | Corrigé à la source : `naming` suffixe désormais `postgres` comme le coffre et l'ACR |
| Ingress rejeté, `spec.tls[0].hosts[0]` invalide | `custom_domain` vidé | Le garder renseigné (§4.2) |
| `db-migrate` échoue sur `schema "auth" does not exist` | Les migrations de `supabase/migrations/` visent Supabase ; le Job pointe `DATABASE_URL` sur le PostgreSQL Azure | Incohérence préexistante du dépôt. Sans effet sur l'application : l'ETL écrit dans Supabase |
| Un apply annoncé réussi alors qu'il a échoué | `terraform apply > log; echo $?` renvoie le code de l'`echo` | Capturer le code AVANT toute autre commande |

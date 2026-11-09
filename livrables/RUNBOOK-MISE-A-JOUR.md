# Runbook — Mettre à jour SIVAX

> Rédigé le 19 août 2026 à partir de l'état réel du dépôt, des pipelines Azure DevOps
> (`cloud-243/sivax`) et de l'inventaire Azure de l'abonnement `acf4a7fb…828e4`.
> Tous les chiffres et toutes les configurations cités ici ont été relevés, pas estimés.

---

## 0. Le modèle, en une page

Trois règles suffisent à comprendre tout le reste.

**1. La branche est l'environnement.** `dev` déploie le cluster dev, `prod` déploie le
cluster prod. Rien à sélectionner : la branche poussée est la branche déployée. Chaque
cluster a son Flux qui ne suit qu'une branche (`gitops_branch` dans Terraform), donc un
tag ne peut pas atterrir sur le mauvais environnement.

**2. Déployer = pousser un commit.** Le pipeline ne fait pas `kubectl apply`. Il construit
l'image, la pousse dans l'ACR, puis modifie **une seule ligne** dans l'overlay de la branche —
le tag de l'image — et pousse ce commit. Flux, dans le cluster, réconcilie. Conséquence
utile : le cluster et le dépôt ne peuvent jamais diverger silencieusement, l'état déployé
est lisible dans git.

**3. Les migrations passent avant l'image.** La migration de base est lancée comme un Job
épinglé sur la **nouvelle** image, pendant que l'ancienne version sert encore. Le tag n'est
déplacé qu'une fois la migration réussie. Le schéma n'est donc jamais en retard sur le code
qui l'attend.

### Les six pipelines

| Pipeline | Rôle | Déclenchement |
|---|---|---|
| `app-build` | typecheck, lint, tests, build des images, scan, push | **auto** sur push `dev`/`prod` |
| `k8s-deploy` | migration, bump du tag, réconciliation Flux | **auto** à la fin d'`app-build` |
| `k8s-validate` | `kustomize build` + `kubeconform` des overlays | pull request seulement |
| `iac-plan` | `terraform plan` + tflint + checkov + gitleaks | pull request seulement |
| `iac-apply` | `terraform apply` | **auto** sur push touchant `infra/` hors `infra/k8s` |
| `iac-drift` | détection de dérive Azure vs Terraform | **auto**, tous les jours à 06:00 UTC |

---

## 1. Se connecter à Azure DevOps

### Par le portail

Organisation **`cloud-243`**, projet **`sivax`** :

```
https://dev.azure.com/cloud-243/sivax
```

Les pages utiles :

| Ce que vous cherchez | Où |
|---|---|
| État des runs | Pipelines → Pipelines |
| Approuver un déploiement prod | Pipelines → Environments → `prod` |
| Secrets et clés | Pipelines → Library → groupes `diav1-dev` / `diav1-prod` |
| Connexions Azure et GitHub | Project settings → Service connections |

### Par l'API (scripts, diagnostic, CI)

Le jeton d'accès personnel est dans **`infra/.env`**, variable `AZURE_DEVOPS_TOKEN`.
Ce fichier n'est pas versionné et ne doit jamais l'être. L'authentification est un
*basic auth* dont l'utilisateur est vide et le mot de passe est le PAT :

```bash
set -a; . ./infra/.env; set +a
AUTH=$(printf ":%s" "$AZURE_DEVOPS_TOKEN" | base64 -w0)
BASE="https://dev.azure.com/$Azure_DevOps_organization/$Azure_DevOps_project/_apis"
```

Lister les pipelines et leur identifiant :

```bash
curl -sS -H "Authorization: Basic $AUTH" "$BASE/pipelines?api-version=7.1"
```

Voir les derniers runs, toutes définitions confondues :

```bash
curl -sS -H "Authorization: Basic $AUTH" "$BASE/build/builds?api-version=7.1&\$top=10&queryOrder=queueTimeDescending"
```

Lancer `app-build` à la main sur une branche — c'est le remède à connaître, il sert dans
plusieurs pannes décrites plus bas :

```bash
curl -sS -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  -d '{"resources":{"repositories":{"self":{"refName":"refs/heads/prod"}}}}' \
  "$BASE/pipelines/1/runs?api-version=7.1"
```

Identifiants des pipelines : **1** app-build, **2** k8s-deploy, **3** k8s-validate,
**4** iac-plan, **5** iac-apply, **6** iac-drift.

Lire le journal d'une étape qui a échoué :

```bash
curl -sS -H "Authorization: Basic $AUTH" "$BASE/build/builds/<buildId>/timeline?api-version=7.1"
curl -sS -H "Authorization: Basic $AUTH" "$BASE/build/builds/<buildId>/logs/<logId>?api-version=7.1"
```

### Ce qui est déjà configuré

Vérifié le 19/08 — rien à créer, tout est en place :

- **Service connections** : `azure-dev` et `azure-prod` (azurerm, OIDC), `github-fidelensadi`, `mbulamboma`.
- **Groupes de variables** `diav1-dev` et `diav1-prod`, 18 clés chacun : `ACR_LOGIN_SERVER`,
  `ACR_NAME`, `AZURE_SUBSCRIPTION_ID`, `COSIGN_KEY_NAME`, `DHIS2_PASSWORD`, `ELEVENLABS_API_KEY`,
  `GITHUB_TOKEN`, `KEY_VAULT_NAME`, `OPENAI_API_KEY`, `ORCHESTRATOR`, `PUBLIC_URL`,
  `RESEND_API_KEY`, `RESOURCE_GROUP`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_URL`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`.
- **Environnements** : `dev` sans aucun contrôle → déploiement entièrement automatique.
  `prod` avec un contrôle d'**approbation** (fenêtre de 30 jours).

---

## 2. Mettre à jour l'application — dev

```bash
git checkout dev
git pull origin dev          # indispensable : le pipeline pousse lui-même des commits
# … vos modifications …
git add -A
git commit -m "feat: description du changement"
git push origin dev
```

C'est tout. À partir de là, la chaîne se déroule seule :

```
push dev
  └── app-build          typecheck → lint → budget de perf → tests backend → images → Trivy → push ACR → Cosign
        └── k8s-deploy   migration BD → bump du tag → commit → push → réconciliation Flux → attente du rollout
```

Comptez **une dizaine de minutes** pour `app-build` et **trois à quatre minutes** pour
`k8s-deploy`, sur un seul agent hébergé — les runs se mettent en file plutôt que de tourner
en parallèle.

### Ce qui ne déclenche rien

`app-build` **exclut** de son filtre de chemins : `infra/`, `livrables/`, `.azuredevops/`,
`.github/`, `README.md`, `documentation.md`, `improve.md`. Un commit qui ne touche que ces
répertoires ne relance pas de build — c'est voulu, mais c'est une source de « pourquoi rien
ne se passe ? ».

---

## 3. Promouvoir en production

```bash
git checkout prod
git pull origin prod
git merge dev
git push origin prod
```

Puis, **et seulement pour prod**, une action humaine : le déploiement s'arrête devant le
contrôle d'approbation de l'environnement `prod`. Allez sur
**Pipelines → Environments → prod**, vérifiez le tag d'image proposé et l'état de dev, et
approuvez. L'instruction affichée le rappelle : *« Promotion en production. Verifier le tag
d'image et l'etat de dev avant d'approuver. »*

Tant que personne n'approuve, le run reste ouvert (30 jours) — il n'est pas en panne, il
attend.

> **Piège connu, voir §5.4** : si le merge `dev → prod` emporte un ancien commit de
> déploiement portant `[skip ci]`, le push sera **silencieux** — aucun build. Vérifiez
> toujours qu'un run est bien parti après un push sur prod.

---

## 4. Valider chaque étape

### 4.1 Ce que la chaîne valide toute seule

| # | Étape | Ce qu'elle garantit | Bloquante ? |
|---|---|---|---|
| 1 | `npm ci` | les dépendances verrouillées s'installent | oui |
| 2 | Typecheck | TypeScript compile | oui |
| 3 | Lint | règles ESLint respectées | oui |
| 4 | Performance budget | le poids des assets statiques tient dans le budget | oui |
| 5 | Python syntax check | `compileall` sur le backend | oui |
| 6 | **Backend — dependency resolution and tests** | `pip check` (les versions épinglées résolvent) + `pytest` | **oui** (rendue bloquante le 18/08) |
| 7 | Build des images | le `Dockerfile` construit | oui |
| 8 | **Trivy scan** | aucune CVE HIGH/CRITICAL corrigeable dans l'image | **oui** |
| 9 | Push ACR | l'image est publiée, plus le tag `latest` | oui |
| 10 | Cosign | l'image est signée avec la clé du Key Vault | non — sautée si `COSIGN_KEY_NAME` est vide |
| 11 | Run database migrations | le schéma est à jour **avant** le basculement | oui |
| 12 | Bump image tags + garde | `newName` a survécu à `kustomize edit` | oui |
| 13 | Reconcile and wait for rollout | Flux a réconcilié et les pods sont prêts | oui |

L'étape 6 mérite un mot : `compileall` ne prouve que la syntaxe. C'est `pip check` qui
vérifie que les versions épinglées résolvent réellement ensemble, et `pytest` qui attrape
les ruptures d'API qu'un scan d'image ne verra jamais. Avant le 18/08 cette étape était en
`continueOnError` — un test rouge partait quand même en production.

### 4.2 Comment vérifier à la main

**Avant de pousser**, en local :

```bash
npx tsc --noEmit && npm run lint && npm run perf:budget
cd backend && python -m compileall -q app && python -m pip check && python -m pytest tests -q
```

Ce sont exactement les commandes du pipeline — il n'existe pas de script
`npm run typecheck`, le pipeline appelle `npx tsc --noEmit` directement.

**Après le push**, dans l'ordre où les questions se posent :

| Question | Comment y répondre |
|---|---|
| Le build est-il parti ? | Pipelines → app-build, ou l'appel `build/builds` du §1 |
| Quelle étape a échoué ? | l'onglet du run, ou l'API `timeline` (§1) |
| L'image est-elle dans l'ACR ? | Azure → `acrdiav1dev2d24` / `acrdiav1proded7d` → Repositories |
| Le tag a-t-il bougé ? | `git log --oneline -1 origin/dev` → un commit `deploy(dev): image sha-…` |
| Le cluster a-t-il pris l'image ? | l'étape *Reconcile and wait for rollout* est verte |
| Quel tag tourne réellement ? | `git show origin/prod:infra/k8s/overlays/prod/kustomization.yaml` |

Le tableau *Summary* affiché en fin de run récapitule cluster, tag et si l'overlay a
effectivement changé.

**Valider les manifestes sans attendre une PR** — utile avant de toucher à `infra/k8s` :

```bash
kustomize build infra/k8s/overlays/dev | kubeconform -strict -summary \
  -kubernetes-version 1.34.0 -ignore-missing-schemas
```

**Valider l'infrastructure sans appliquer** :

```bash
cd infra/envs/dev
terraform init -backend-config=backend.hcl
terraform plan -lock=false
```

---

## 5. Ce qui peut casser

Chaque panne listée ici s'est **réellement produite** sur ce dépôt, sauf mention contraire.

### 5.1 Trivy — le téléchargement échoue (404)

**Symptôme.** L'étape *Trivy scan* échoue immédiatement, avant tout scan. Le run est rouge
et donne l'impression que l'image est vulnérable.

**Cause.** La version de Trivy apparaissait deux fois dans l'URL — dans le tag et dans le nom
de l'archive — et les deux ont dérivé. `v0.58.1` a disparu du dépôt amont, le téléchargement
a renvoyé 404, `set -euo pipefail` a arrêté l'étape.

**État.** Corrigé : la version est tenue **une seule fois** dans `TRIVY_VERSION=0.74.0`
(`.azuredevops/templates/steps-build-image.yml`).

**Si ça revient.** Vérifiez que le tag existe encore sur `github.com/aquasecurity/trivy/releases`
et montez `TRIVY_VERSION`. C'est le genre de panne à traiter tout de suite : elle bloque
toute la chaîne, `k8s-deploy` ne se déclenchant qu'après un `app-build` vert.

### 5.2 Trivy — une vraie vulnérabilité

**Symptôme.** L'étape scanne puis échoue en listant des CVE.

**Cause.** Le scan est volontairement strict : `--exit-code 1 --severity HIGH,CRITICAL
--ignore-unfixed`. Seules les vulnérabilités **corrigeables** comptent — si un correctif
existe en amont, l'image doit le prendre.

**Remède.** Montez l'image de base ou la dépendance visée, puis repoussez. Ne neutralisez pas
le scan : c'est la seule barrière avant l'ACR.

### 5.3 La porte de tests backend

**Symptôme.** *Backend — dependency resolution and tests* est rouge.

**Deux causes distinctes.** Soit `pip check` : les versions de `requirements.txt` ne
résolvent plus ensemble — c'est ce qui a imposé de monter `fastapi` de 0.115 à 0.141 pour
laisser passer un `starlette` corrigé. Soit `pytest` : une rupture d'API réelle.

**Remède.** Reproduisez en local (`pip install -r requirements.txt && pip check && pytest tests -q`).
Ne remettez pas `continueOnError` : c'est exactement ce qui laissait passer des images cassées.

### 5.4 Le `[skip ci]` qui voyage — la panne la plus déroutante

**Symptôme.** Un push part sans erreur… et **aucun pipeline ne démarre**. Rien dans
l'interface, aucun message.

**Cause.** Azure DevOps ignore un push dès que **n'importe lequel** de ses commits porte
`[skip ci]` — pas seulement le dernier. Les commits `deploy(env): image sha-… [skip ci]`
produits par le pipeline finissent par voyager : un merge `dev → prod` les emporte, et le
push de prod devient muet alors qu'il contient du vrai code.

**Constaté le 18/08** : le push de prod embarquait deux `deploy(dev) … [skip ci]`. Aucun
build. Le même soir, le push de dev, sans marqueur, a déclenché normalement.

**État.** Corrigé à la source — le marqueur a été retiré du message de commit de déploiement.
Il était de toute façon redondant : `app-build` exclut déjà `infra/`, `k8s-deploy` et
`k8s-validate` sont en `trigger: none`, `iac-apply` exclut `infra/k8s`. Aucun pipeline ne
pouvait reboucler sur ce commit.

**Reliquat.** Deux commits marqués circulent encore (`f655cb9` sur dev/main, `0ff8c53` sur
prod). Le prochain merge `dev → prod` peut donc encore faire taire la CI **une dernière
fois**.

**Remède immédiat.** Relancer `app-build` à la main sur la branche concernée — la commande
du §1.

**Réflexe à garder.** Après tout push sur `prod`, vérifiez qu'un run est bien parti.

### 5.5 `kustomize edit` qui perd le registre

**Symptôme.** Les pods ne démarrent plus, `ImagePullBackOff` sur les deux clusters.

**Cause.** `kustomize edit set image NOM:TAG` écrit `newTag` et **supprime `newName`**.
Or `newName` porte `${acr_login_server}`, que Flux substitue depuis les sorties Terraform.
Sans lui, les images se résolvent sur Docker Hub. Le dépôt a déjà été réparé à la main pour
cette raison exacte (commit `ca9e1ca`).

**État.** Corrigé : le pipeline relit le `newName` existant et le repasse explicitement sous
la forme `NOM=NEWNAME:TAG`, puis **vérifie** que `newName: …/diav1-*` a survécu. Si ce n'est
pas le cas, il refuse de continuer plutôt que de pousser un overlay cassé.

**Vérification manuelle.**

```bash
git show origin/prod:infra/k8s/overlays/prod/kustomization.yaml | grep -A2 'name: diav1'
```

Vous devez voir un `newName` **et** un `newTag`.

### 5.6 Une variable de pipeline qui écrase `PATH`

**Symptôme.** `Unable to locate executable file: 'bash'` sur un agent Linux parfaitement sain.

**Cause.** Azure Pipelines exporte chaque variable dans l'environnement de la tâche, en
majuscules — **les legs de matrice compris**. `k8s-validate` déclarait une matrice sur une
variable nommée `path` : elle devenait `PATH=overlays/dev` et effaçait le `PATH` de l'agent.
Les quatre legs mouraient à la première étape. GitHub Actions n'a pas cette collision, ce qui
explique que le nom ait survécu à la traduction des workflows.

**État.** Corrigé, renommée en `overlayPath`. Run de contrôle vert le 18/08.

**Règle à retenir.** Ne nommez jamais une variable de pipeline `path`, `temp`, `home`, `user`,
`os`, `shell`. Un *input* de tâche portant ce nom (comme `path:` dans `Cache@2`) est sans
danger — seules les **variables** sont exportées.

### 5.7 Le déploiement prod semble bloqué

**Symptôme.** `k8s-deploy` reste ouvert des heures sur prod.

**Cause.** Ce n'est pas une panne : c'est le contrôle d'approbation. Il attend un humain,
jusqu'à 30 jours.

**Remède.** Pipelines → Environments → `prod` → approuver. Pour distinguer une attente d'un
blocage réel, l'API `timeline` montre un enregistrement `Checkpoint.Approval` en cours.

### 5.8 `k8s-validate` et `iac-plan` ne se déclenchent jamais

**Symptôme.** Ces deux pipelines affichent zéro run alors qu'ils sont correctement enregistrés.

**Cause.** Ce sont des **portes de pull request** (`trigger: none` + `pr:`). L'équipe pousse
directement sur `dev` et `prod` sans ouvrir de PR : la porte ne s'arme jamais. Tout le
contrôle qualité infra — `terraform plan`, tflint, checkov, gitleaks, `kustomize`/`kubeconform` —
existe, fonctionne, et n'est jamais exécuté.

**Décision à prendre.** Soit ajouter un `trigger:` sur push `dev`/`prod` — ils tournent
toujours, mais en constat après coup. Soit passer les merges `dev → prod` par PR — vraies
portes bloquantes, mais changement d'habitudes. En attendant, lancez-les à la main avant tout
changement d'infra.

### 5.9 Écarts de configuration à corriger

Relevés le 19/08, sans incident déclaré à ce jour, mais réels :

- **`kubeconform` valide contre Kubernetes 1.30, les clusters tournent en 1.34.**
  `KUBERNETES_VERSION: "1.30.0"` dans `k8s-validate.yml` alors que les deux AKS sont en 1.34.
  Le commentaire du fichier dit lui-même que cette valeur doit suivre le plan de contrôle.
  Un champ retiré ou déprécié en 1.31+ passerait la validation et serait refusé par le cluster.
- **dev n'a aucun autoscaling.** Les deux pools de dev sont à `count: 1` avec
  `enableAutoScaling: false`, alors que prod a bien un pool utilisateur élastique de 1 à 2.
  Si l'intention était de laisser dev respirer jusqu'à 2 nœuds, ce n'est pas ce qui est
  déployé.

### 5.10 Quotas Azure

**Symptôme.** `terraform apply` refuse de créer des nœuds, ou un autoscale ne monte pas.

**Cause.** Le quota vCPU est **régional**. C'est la raison d'être du choix d'architecture :
dev et prod dans la même région se partageraient 10 vCPU, sans marge pour un autoscale ni
pour le surge de 33 % d'une montée de version. prod est donc en `swedencentral` avec ses
propres 10 vCPU, dev en `francecentral`.

**À savoir aussi.** L'abonnement refuse les nouveaux comptes de stockage en `westeurope`,
et le quota de profils Front Door est à 0 — d'où `enable_frontdoor = false` et un service
directement exposé par l'IP publique de l'ingress.

### 5.11 La migration de base échoue

**Symptôme.** *Run database migrations* est rouge, le tag n'est pas déplacé.

**Conséquence — et c'est la bonne.** L'ancienne version continue de servir. Rien n'est cassé
en production, le déploiement s'est simplement arrêté avant le basculement.

**Remède.** Lisez le journal du Job, corrigez la migration, repoussez. Ne déplacez jamais le
tag à la main pour « débloquer » : vous mettriez le code en avance sur son schéma.

---

## 6. Coût de la plateforme telle que déployée

### 6.1 Ce qui tourne réellement

Inventaire relevé sur l'abonnement le 19/08 — **94 ressources**, deux environnements
complets.

| | dev — `francecentral` | prod — `swedencentral` |
|---|---|---|
| Cluster AKS | `aks-diav1-dev-frc`, 1.34, tier Free | `aks-diav1-prod-sdc`, 1.34, tier Free |
| Serveur d'API | public | **privé** (private endpoint) |
| Pool système | 1 × `Standard_D2s_v6`, sans autoscale | 1 × `Standard_D2s_v6`, sans autoscale |
| Pool utilisateur | 1 × `Standard_D2s_v6`, sans autoscale | 2 × `Standard_D2s_v6`, autoscale **1 → 2** |
| Disques OS | 128 Go Premium SSD par nœud | idem |
| PostgreSQL | `Standard_B1ms`, 32 Go, PG 16 | `Standard_B2s`, 64 Go, PG 16 |
| Sauvegardes | 7 jours, sans géo-redondance, sans HA | idem |
| Registre | ACR Basic | ACR Basic |
| Réseau | VNet, NAT Gateway, 2 IP publiques, 6 zones DNS privées | idem |
| Observabilité | Log Analytics + Application Insights + 2 alertes | idem |

Base de données et Key Vault sont fermés à l'Internet public : `publicNetworkAccess`
désactivé, accès par private endpoint.

### 6.2 Le coût mensuel

Prix unitaires relevés sur l'API *Azure Retail Prices* (EUR, tarif à la consommation),
volumes tirés de la configuration réellement déployée. Base de 730 heures.

**dev — francecentral**

| Poste | EUR / mois |
|---|---|
| 2 nœuds AKS `D2s v6` @ 0,1036 €/h | 151,26 |
| 2 disques OS P10 128 Go @ 20,93 € | 41,86 |
| NAT Gateway (passerelle + données) | 37,50 |
| PostgreSQL `B1ms` @ 0,0167 €/h | 12,19 |
| 2 IP publiques statiques @ 0,0044 €/h | 6,42 |
| Log Analytics + Application Insights | 6,20 |
| ACR Basic | 2,30 |
| DNS privé, Key Vault, divers | 2,50 |
| **Sous-total dev** | **260** |

**prod — swedencentral**

| Poste | 2 nœuds | 3 nœuds |
|---|---|---|
| Nœuds AKS `D2s v6` @ 0,0939 €/h | 137,09 | 205,64 |
| Disques OS P10 128 Go @ 19,03 € | 38,05 | 57,08 |
| NAT Gateway | 32,00 | 32,00 |
| PostgreSQL `B2s` @ 0,0349 €/h | 25,48 | 25,48 |
| 2 IP publiques statiques | 6,42 | 6,42 |
| ACR Basic, Log Analytics, DNS, Key Vault | 5,80 | 5,80 |
| **Sous-total prod** | **245** | **332** |

### Total

| | EUR / mois |
|---|---|
| Plancher — prod au repos (2 nœuds) | **≈ 505** |
| Plafond — prod à sa capacité maximale (3 nœuds) | **≈ 593** |

L'écart entre les deux, **88 €**, est exactement le prix de l'élasticité de prod : un nœud
utilisateur supplémentaire et son disque. Le plafond reste **sous le budget de 800 €/mois**
fixé au départ, avec environ 25 % de marge.

### 6.3 Contrôle avec la facturation réelle

La plateforme n'a que trois jours d'existence, la facture n'est donc pas encore
représentative — mais elle permet de vérifier le modèle. Consommation réelle relevée dans
Cost Management :

| Jour | Total | dev | prod `swedencentral` | prod `francecentral` (supprimé) |
|---|---|---|---|---|
| 16/08 | 0,61 € | 0,61 € | — | — |
| 17/08 | 17,73 € | 11,69 € | — | 6,03 € |
| 18/08 | 13,39 € | 7,07 € | 6,17 € | 0,16 € |

Le 18/08 est la première journée complète avec l'empreinte actuelle. **7,07 €/jour pour dev**,
soit environ **212 €/mois** — en dessous des 260 € du modèle, l'écart venant des paliers
gratuits (plan de contrôle AKS en tier Free, premiers Go de Log Analytics offerts).

Le modèle du §6.2 est donc un **majorant honnête** : la facture réelle devrait se situer
dans le bas de la fourchette, autour de **450 à 550 €/mois**.

> La ligne `rg-diav1-prod-frc` correspond à une première prod déployée en `francecentral`
> puis supprimée au profit de `swedencentral`, pour la raison de quota expliquée en §5.10.
> Elle a coûté 6,20 € au total et n'apparaîtra plus.

### 6.4 Ce qui n'est pas dans ce chiffre

La facture Azure ne couvre pas les services externes, facturés séparément :

- **OpenAI** — API externe, à l'usage (choix assumé plutôt qu'Azure OpenAI)
- **Supabase** — authentification et tables ETL
- **Resend** — envoi d'e-mails
- **ElevenLabs** — synthèse vocale
- **Le domaine `sivax.health`** — chez Hostinger
- **Azure DevOps** — un agent hébergé gratuit, suffisant aujourd'hui ; c'est lui qui impose
  que les runs se mettent en file au lieu de tourner en parallèle

### 6.5 Où économiser, si besoin

Par ordre de rendement décroissant :

1. **Éteindre dev hors heures ouvrées.** Les nœuds dev représentent 151 €/mois ; les arrêter
   nuits et week-ends en supprimerait environ les deux tiers, soit **~100 €/mois**.
2. **Descendre les disques OS.** 128 Go Premium SSD par nœud pour des nœuds sans état, c'est
   confortable. Passer à 64 Go en Standard SSD économiserait **~60 €/mois** sur les deux
   environnements.
3. **Mutualiser les NAT Gateway.** 70 €/mois à deux, pour un trafic sortant modeste. À
   réexaminer si le trafic reste faible.
4. **Réserver les instances.** Un engagement d'un an sur les nœuds de prod retire environ
   **40 %** de leur coût — pertinent seulement quand l'empreinte sera stabilisée.

---

## Annexe — Aide-mémoire

```bash
# Mettre à jour dev
git checkout dev && git pull origin dev && git push origin dev

# Promouvoir en prod (puis approuver dans l'interface)
git checkout prod && git pull origin prod && git merge dev && git push origin prod

# Vérifier qu'un run est bien parti
set -a; . ./infra/.env; set +a
AUTH=$(printf ":%s" "$AZURE_DEVOPS_TOKEN" | base64 -w0)
curl -sS -H "Authorization: Basic $AUTH" \
  "https://dev.azure.com/$Azure_DevOps_organization/$Azure_DevOps_project/_apis/build/builds?api-version=7.1&\$top=5&queryOrder=queueTimeDescending"

# Relancer app-build à la main (remède au [skip ci])
curl -sS -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  -d '{"resources":{"repositories":{"self":{"refName":"refs/heads/prod"}}}}' \
  "https://dev.azure.com/$Azure_DevOps_organization/$Azure_DevOps_project/_apis/pipelines/1/runs?api-version=7.1"

# Quel tag tourne en prod
git show origin/prod:infra/k8s/overlays/prod/kustomization.yaml | grep -A2 'name: diav1'
```

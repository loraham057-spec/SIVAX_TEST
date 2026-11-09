#!/usr/bin/env bash
#
# Construit et pousse les deux images DEPUIS LE CLUSTER, avec Kaniko.
#
# Pourquoi ce second chemin existe. `aws-build-images.sh` passe par CodeBuild,
# qui est le bon outil ; mais sur un compte AWS recent TOUS les quotas de builds
# concurrents valent zero jusqu'a ce qu'une demande d'augmentation soit
# accordee. `StartBuild` echoue alors sur « Cannot have more than 0 builds in
# queue for the account » : le compte est sain, le projet est correct, et rien
# ne peut demarrer. Attendre un quota n'est pas une strategie de deploiement.
#
# Le cluster, lui, est deja la. Kaniko construit dans un pod, sans demon Docker
# et sans privileges, lit la meme archive de source dans S3 et pousse dans les
# memes depots ECR. Le pod porte le role IRSA cree par le module image-builder,
# donc aucun identifiant n'est monte nulle part.
#
#   ./scripts/aws-build-images-incluster.sh dev
#
# Prerequis : kubectl configure sur le cluster (aws eks update-kubeconfig),
# l'AWS CLI authentifiee, et l'environnement applique.

set -euo pipefail

ENV_NAME="${1:-dev}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$REPO_ROOT/infra/aws/envs/$ENV_NAME"

[ -d "$ENV_DIR" ] || { echo "Environnement inconnu : $ENV_NAME" >&2; exit 1; }

cd "$ENV_DIR"

# Lecture d'une valeur dans une sortie Terraform en JSON. `jq` d'abord, python
# en repli : ce script tourne aussi bien sur un agent Linux que sur le poste
# depuis lequel un environnement est amorce a la main, et jq n'y est pas
# forcement installe. Faire dependre un deploiement d'un outil optionnel, c'est
# le faire echouer sur la machine ou on en a le plus besoin.
json_get() {
  local json="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r ".$key"
  else
    printf '%s' "$json" | python -c "import json,sys;print(json.load(sys.stdin)['$key'])"
  fi
}

BUILDER=$(terraform output -json image_builder)
BUCKET=$(json_get "$BUILDER" source_bucket)
ROLE_ARN=$(json_get "$BUILDER" pod_role_arn)
SA=$(json_get "$BUILDER" service_account)
REGION=$(terraform output -raw region)
# Namespace dedie, hors du namespace applicatif : celui-ci applique
# PodSecurity « restricted », que Kaniko ne peut pas satisfaire.
NAMESPACE="${NAMESPACE:-$(json_get "$BUILDER" namespace)}"

REPOS=$(terraform output -json ecr_repository_urls)
WEB_REPO=$(json_get "$REPOS" web)
AI_REPO=$(json_get "$REPOS" ai)

SUPABASE_URL=$(grep -E '^supabase_url' terraform.tfvars | cut -d'"' -f2)

# Valeurs publiques compilees DANS le bundle client par Next.js : elles doivent
# etre presentes au BUILD, pas a l'execution. Une image construite sans elles
# sert une application qui ne sait pas joindre Supabase — et le symptome
# n'apparait qu'a la premiere requete, loin d'ici. Elles arrivent par les memes
# TF_VAR_* que Terraform, donc une seule source pour les deux.
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${TF_VAR_supabase_anon_key:-}}"
VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-${TF_VAR_vapid_public_key:-}}"
[ -n "$SUPABASE_ANON_KEY" ] || { echo "SUPABASE_ANON_KEY absent (ni la variable, ni TF_VAR_supabase_anon_key)" >&2; exit 1; }

GIT_REF="${GIT_REF:-HEAD}"
TAG="${IMAGE_TAG:-sha-$(git -C "$REPO_ROOT" rev-parse --short=7 "$GIT_REF")}"

echo "Environnement : $ENV_NAME"
echo "Tag           : $TAG"

# ─── Source ────────────────────────────────────────────────
#
# Kaniko attend un contexte S3 en .tar.gz. `git archive` plutot qu'une archive
# du repertoire de travail : il ne prend QUE ce qui est suivi par git, donc
# node_modules, .next, les etats Terraform et .env.local ne peuvent pas partir
# par accident. Une modification non commitee n'est pas construite — c'est
# voulu.
TMP="$(mktemp -d)"
# La reference construite, et non le repertoire de travail : prod se construit
# depuis la branche prod meme quand la copie locale est sur dev. GIT_REF permet
# de le dire explicitement plutot que de basculer la copie de travail.
git -C "$REPO_ROOT" archive --format=tar.gz -o "$TMP/context.tar.gz" "$GIT_REF"
echo "Archive       : $(du -h "$TMP/context.tar.gz" | cut -f1)"
aws s3 cp "$TMP/context.tar.gz" "s3://$BUCKET/context.tar.gz" --region "$REGION" --only-show-errors
rm -rf "$TMP"

# ─── ServiceAccount du build ───────────────────────────────
#
# Applique ici et non dans les overlays GitOps : c'est un outil d'amorcage, pas
# une piece de l'application. Flux ne doit pas l'adopter, et le retirer ne doit
# rien reconcilier.
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NAMESPACE" create serviceaccount "$SA" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NAMESPACE" annotate serviceaccount "$SA" \
  "eks.amazonaws.com/role-arn=$ROLE_ARN" --overwrite >/dev/null

launch() {
  local name="$1" repo="$2" dockerfile="$3" job="kaniko-$1-${TAG#sha-}"

  kubectl -n "$NAMESPACE" delete job "$job" --ignore-not-found >/dev/null

  # --single-snapshot : Kaniko ne prend qu'un instantane du systeme de fichiers
  # a la fin plutot qu'apres chaque instruction. Sur un build Node volumineux,
  # c'est la difference entre quelques minutes et un pod qui se fait tuer pour
  # depassement memoire.
  cat <<YAML | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: $job
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/name: image-builder
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: image-builder
    spec:
      serviceAccountName: $SA
      restartPolicy: Never
      containers:
        - name: kaniko
          image: gcr.io/kaniko-project/executor:v1.23.2
          args:
            - --context=s3://$BUCKET/context.tar.gz
            - --dockerfile=$dockerfile
            - --destination=$repo:$TAG
            - --destination=$repo:latest
            - --single-snapshot
            - --cache=false
            - --build-arg=NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
            - --build-arg=NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
            - --build-arg=NEXT_PUBLIC_VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
            - --build-arg=BUILD_ID=$TAG
          env:
            - name: AWS_REGION
              value: $REGION
            - name: AWS_SDK_LOAD_CONFIG
              value: "true"
          resources:
            # La demande tient dans ce qui reste sur un noeud de dev une fois
            # l'application et les add-ons places (mesure : environ 1,3 Gio
            # libres sur 3,3). La limite, elle, est calee sur ce dont le build
            # Next.js a reellement besoin : demander 2 Gio laissait le pod
            # « Pending / Insufficient memory » indefiniment, sans qu'aucun
            # journal n'apparaisse.
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              memory: 2500Mi
YAML
  echo "  $name : job $job lance"
}

# SEQUENTIEL, et non en parallele. Sur un cluster de dev calibre au plus juste,
# deux builds simultanes ne tiennent pas en memoire : le second reste
# « Pending » jusqu'a expiration, et l'echec ressemble a un blocage plutot qu'a
# un manque de place. Le gain de temps du parallele ne vaut pas ce diagnostic.
run_build() {
  local name="$1" repo="$2" dockerfile="$3" job="kaniko-$1-${TAG#sha-}"

  launch "$name" "$repo" "$dockerfile"
  echo "Attente de $job"
  if kubectl -n "$NAMESPACE" wait --for=condition=complete "job/$job" --timeout=45m 2>/dev/null; then
    echo "  $name : succes"
    return 0
  fi
  echo "  $name : echec" >&2
  kubectl -n "$NAMESPACE" logs "job/$job" --tail=60 >&2 || true
  return 1
}

rc=0
run_build web "$WEB_REPO" "Dockerfile"          || rc=1
run_build ai  "$AI_REPO"  "backend/Dockerfile"  || rc=1
[ $rc -eq 0 ] || exit $rc

# ─── Deploiement : deplacer le tag, Flux le porte ──────────
#
# Meme geste que le buildspec CodeBuild (infra/aws/modules/cicd/buildspec.yml).
# Les deux coexistent a dessein : le pipeline est le chemin normal, ce script
# est le chemin utilisable AUJOURD'HUI, tant que le compte refuse d'executer
# des builds (« Cannot have more than 0 builds in queue for the account »).
#
# DEPLOY=0 s'arrete apres la poussee des images, sans toucher a git.
[ "${DEPLOY:-1}" = "1" ] || { echo "Images poussees ; deploiement non demande."; exit 0; }

command -v kustomize >/dev/null || {
  echo "kustomize est requis pour deplacer le tag (DEPLOY=0 pour s'en passer)." >&2
  exit 1
}

BRANCH="${BRANCH:-$ENV_NAME}"
cd "$REPO_ROOT/infra/k8s/overlays/$ENV_NAME"

# `kustomize edit set image NOM:TAG` ecrit newTag et SUPPRIME newName, qui
# porte la substitution du registre. Sans lui, les images se resolvent vers
# Docker Hub et le cluster cesse de demarrer — ce depot a deja ete repare a la
# main une fois pour cette raison. On relit donc newName et on le repasse.
for img in web ai; do
  name="diav1-${img}"
  newname=$(awk -v n="$name" '
    $1=="-" && $2=="name:" && $3==n {found=1; next}
    found && $1=="newName:" {print $2; exit}
    found && $1=="-" {exit}
  ' kustomization.yaml)
  [ -n "$newname" ] || { echo "newName manquant pour $name : refus de deplacer le tag." >&2; exit 1; }
  kustomize edit set image "${name}=${newname}:${TAG}"
done

for img in web ai; do
  grep -q "newName: \${${img}_image_repo}" kustomization.yaml || {
    echo "newName pour diav1-${img} n'a pas survecu a l'edition." >&2
    exit 1
  }
done

cd "$REPO_ROOT"
if git diff --quiet -- "infra/k8s/overlays/$ENV_NAME/kustomization.yaml"; then
  echo "Le tag etait deja a jour : rien a deployer."
else
  git add "infra/k8s/overlays/$ENV_NAME/kustomization.yaml"
  git commit -q -m "deploy($ENV_NAME): image $TAG"
  git push -q origin "HEAD:$BRANCH"
  echo "Tag $TAG pousse sur $BRANCH ; Flux reconcilie dans les deux minutes."
fi

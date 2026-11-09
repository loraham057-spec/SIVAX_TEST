#!/usr/bin/env bash
#
# Construit et pousse les deux images DANS AWS, sans Docker sur le poste.
#
# Le travail se fait dans CodeBuild (infra/aws/modules/image-builder) ; ce
# script ne fait que trois choses : fabriquer l'archive de source, la déposer
# dans le bucket de l'environnement, et lancer les deux builds en parallèle
# avant d'attendre leur résultat.
#
# Le tag est celui du commit HEAD (sha-xxxxxxx), la même convention que le
# pipeline — donc une image construite ici et une image construite par
# app-build portent le même nom pour le même code, et l'overlay n'a pas à
# savoir laquelle des deux l'a produite.
#
#   ./scripts/aws-build-images.sh dev
#   ./scripts/aws-build-images.sh prod
#
# Prérequis : AWS CLI authentifiée sur le compte, et l'environnement déjà
# appliqué (le bucket et les projets viennent de terraform).

set -euo pipefail

ENV_NAME="${1:-dev}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$REPO_ROOT/infra/aws/envs/$ENV_NAME"

[ -d "$ENV_DIR" ] || { echo "Environnement inconnu : $ENV_NAME" >&2; exit 1; }

cd "$ENV_DIR"

BUCKET=$(terraform output -json image_builder | jq -r '.source_bucket')
KEY=$(terraform output -json image_builder | jq -r '.source_key')
WEB_PROJECT=$(terraform output -json image_builder | jq -r '.projects.web')
AI_PROJECT=$(terraform output -json image_builder | jq -r '.projects.ai')
REGION=$(terraform output -raw region 2>/dev/null || echo "${AWS_REGION:-eu-west-3}")

TAG="${IMAGE_TAG:-sha-$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD)}"

echo "Environnement : $ENV_NAME"
echo "Tag           : $TAG"
echo "Bucket source : $BUCKET/$KEY"

# ─── Archive de source ─────────────────────────────────────
#
# `git archive` plutôt qu'un zip du répertoire de travail : il ne prend QUE ce
# qui est suivi par git. node_modules, .next, les états Terraform et .env.local
# ne peuvent donc pas partir par accident — la propriété vaut mieux qu'une
# liste d'exclusions qu'on oublie de tenir à jour.
#
# Conséquence à connaître : une modification non commitée n'est pas construite.
# C'est voulu ; ce qui tourne doit correspondre à ce qui est dans git.
TMP_ZIP="$(mktemp -d)/source.zip"
git -C "$REPO_ROOT" archive --format=zip -o "$TMP_ZIP" HEAD
echo "Archive       : $(du -h "$TMP_ZIP" | cut -f1)"

aws s3 cp "$TMP_ZIP" "s3://$BUCKET/$KEY" --region "$REGION" --only-show-errors
rm -rf "$(dirname "$TMP_ZIP")"

# ─── Builds ────────────────────────────────────────────────

start_build() {
  aws codebuild start-build \
    --project-name "$1" \
    --environment-variables-override "name=BUILD_TAG,value=$TAG,type=PLAINTEXT" \
    --region "$REGION" \
    --query 'build.id' --output text
}

WEB_ID=$(start_build "$WEB_PROJECT")
AI_ID=$(start_build "$AI_PROJECT")
echo "Build web     : $WEB_ID"
echo "Build ai      : $AI_ID"

wait_build() {
  local id="$1" name="$2" status
  while true; do
    status=$(aws codebuild batch-get-builds --ids "$id" --region "$REGION" \
      --query 'builds[0].buildStatus' --output text)
    case "$status" in
      SUCCEEDED) echo "  $name : succes"; return 0 ;;
      FAILED|FAULT|STOPPED|TIMED_OUT)
        echo "  $name : $status" >&2
        # Les 60 dernieres lignes suffisent a nommer la cause dans la quasi-totalite
        # des cas ; le journal complet reste dans CloudWatch.
        aws logs tail "/aws/codebuild/diav1-$ENV_NAME" --region "$REGION" \
          --since 30m --format short 2>/dev/null | tail -60 >&2 || true
        return 1 ;;
      *) sleep 15 ;;
    esac
  done
}

rc=0
wait_build "$WEB_ID" web || rc=1
wait_build "$AI_ID"  ai  || rc=1
exit $rc

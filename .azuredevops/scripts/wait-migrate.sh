#!/usr/bin/env bash
# Tourne sur l'agent, contre le kubeconfig ecrit par
# `aws eks update-kubeconfig`. Applique le Job de migration et l'interroge :
# backoffLimit 0 signifie qu'un seul echec est terminal,
# so surface the logs and abort the deploy rather than rolling out a new image
# against a schema that never migrated.
#
# Expects: JOB (job name), and migrate-job.yaml in the same upload.
set -euo pipefail

kubectl -n diav1 delete job "$JOB" --ignore-not-found
kubectl -n diav1 apply -f migrate-job.yaml

for _ in $(seq 1 90); do
  s=$(kubectl -n diav1 get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)
  f=$(kubectl -n diav1 get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || true)
  echo "  succeeded=${s:-0} failed=${f:-0}"
  if [ "${s:-0}" = "1" ]; then echo "Migration succeeded."; exit 0; fi
  if [ -n "${f:-}" ] && [ "${f:-0}" != "0" ]; then
    echo "Migration failed — logs follow:"
    kubectl -n diav1 logs "job/$JOB" --tail=100 || true
    exit 1
  fi
  sleep 10
done

echo "Migration timed out."
exit 1

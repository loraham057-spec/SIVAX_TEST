#!/usr/bin/env bash
# Tourne sur l'agent, contre le kubeconfig ecrit par
# `aws eks update-kubeconfig` — EKS n'a pas d'equivalent d'`az aks command
# invoke`, et n'en a pas besoin : le serveur d'API est joignable directement.
# Bouscule Flux pour que le rollout soit immediat plutot que d'attendre
# l'intervalle de synchronisation, puis bloque dessus. Annoter --all evite de
# dependre des noms donnes aux objets Flux.
#
# Expects: TAG (the image tag that must appear on the running Deployments).
set -euo pipefail

ts=$(date +%s%N)
kubectl -n flux-system annotate --overwrite --all \
  gitrepositories.source.toolkit.fluxcd.io \
  "reconcile.fluxcd.io/requestedAt=$ts" 2>/dev/null || true
kubectl -n flux-system annotate --overwrite --all \
  kustomizations.kustomize.toolkit.fluxcd.io \
  "reconcile.fluxcd.io/requestedAt=$ts" 2>/dev/null || true

# Wait until the running image actually carries the new tag before trusting
# `rollout status`, otherwise it reports the old, already settled ReplicaSet
# as complete.
for d in web ai; do
  echo "Waiting for deploy/$d to reach $TAG"
  for _ in $(seq 1 60); do
    img=$(kubectl -n diav1 get deploy "$d" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    case "$img" in *:"$TAG") break ;; esac
    sleep 10
  done
  kubectl -n diav1 rollout status "deploy/$d" --timeout=300s
done

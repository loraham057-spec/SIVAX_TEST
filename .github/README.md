# Ce dossier ne porte plus de CI

L'intégration et le déploiement continus vivent dans `.azuredevops/`, exécutés
par Azure DevOps Pipelines. Les workflows GitHub Actions ont été retirés pour
qu'il n'existe qu'une seule chaîne de déploiement : deux chaînes visant le même
cluster, ce sont deux sources de vérité et une course entre elles.

GitHub reste l'hébergement du code et la source que Flux réconcilie ; il ne
lance plus rien.

| Ancien workflow GitHub | Pipeline Azure DevOps |
| ---------------------- | --------------------- |
| `iac-plan.yml` | `pipelines/iac-plan.yml` |
| `iac-apply.yml` + `_terraform-apply.yml` | `pipelines/iac-apply.yml` + `templates/stage-terraform-apply.yml` |
| `iac-drift.yml` | `pipelines/iac-drift.yml` |
| `app-build.yml` | `pipelines/app-build.yml` + `templates/steps-build-image.yml` |
| `k8s-validate.yml` | `pipelines/k8s-validate.yml` |
| `k8s-deploy.yml` | `pipelines/k8s-deploy.yml` + `templates/stage-k8s-deploy.yml` |
| `app-deploy.yml` | non traduit — chemin Container Apps, inactif tant que `orchestrator = "aks"` |

La mise en service (service connections, variable groups, environments,
approbations) est décrite dans `.azuredevops/README.md`.

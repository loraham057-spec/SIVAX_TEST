/**
 * Module gitops — amorçage de Flux.
 *
 * Terraform crée le cluster et pose Flux ; il ne gère pas les manifests.
 * L'état applicatif vit dans k8s/, réconcilié en continu — un `kubectl edit`
 * manuel est donc défait plutôt que conservé en silence.
 *
 * Différence avec AKS, où l'extension microsoft.flux et
 * `azurerm_kubernetes_flux_configuration` faisaient les deux d'un coup. Ici :
 *
 *   1. le chart `flux2` installe les contrôleurs et les CRD ;
 *   2. un ConfigMap `cluster-vars` porte toutes les valeurs propres à
 *      l'environnement (ARN de rôles, hôte du registre, URL publique) ;
 *   3. le chart `flux2-sync` crée le GitRepository et la Kustomization racine,
 *      qui pointe sur infra/k8s/flux/<env> ;
 *   4. les Kustomization qui y vivent référencent le ConfigMap par
 *      `postBuild.substituteFrom` — c'est ce qui remplace la substitution
 *      Terraform d'AKS, sans qu'aucune valeur d'environnement n'entre dans git.
 *
 * Cet ordre est le seul qui fonctionne : créer les objets Flux avec le
 * fournisseur Kubernetes échouerait au plan, puisque leurs types n'existent
 * qu'une fois le chart installé.
 */

locals {
  # Épingler la clé d'hôte de GitHub est ce qui donne un sens à la connexion
  # SSH : sans elle, Flux accepterait n'importe quel serveur se présentant
  # comme github.com.
  github_known_hosts = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

  use_ssh = var.use_deploy_key && var.https_token == ""

  repository_url = local.use_ssh ? replace(var.repository_url, "https://github.com/", "ssh://git@github.com/") : var.repository_url
}

resource "kubernetes_namespace" "flux" {
  metadata {
    name = "flux-system"
  }
}

resource "helm_release" "flux" {
  name       = "flux2"
  repository = "https://fluxcd-community.github.io/helm-charts"
  chart      = "flux2"
  version    = var.flux_chart_version
  namespace  = kubernetes_namespace.flux.metadata[0].name

  # Les contrôleurs d'images ne servent pas ici : le pipeline pousse le tag et
  # Flux réconcilie ; les installer ajouterait deux pods qui scrutent ECR.
  set = [
    {
      name  = "imageAutomationController.create"
      value = "false"
    },
    {
      name  = "imageReflectionController.create"
      value = "false"
    },
  ]
}

# ─── Identifiants du dépôt ─────────────────────────────────
#
# Un dépôt privé sans identifiants donne une source « Non-Compliant » et rien
# n'est jamais réconcilié — panne silencieuse, cluster sain et vide.
#
# La clé de déploiement est l'option la plus étroite : bornée à ce dépôt, là où
# un jeton porte le compte entier. Sa moitié privée n'existe que dans l'état et
# dans le cluster ; la moitié publique est une sortie, à déclarer en lecture
# seule dans les paramètres du dépôt.
#
# La variante par jeton HTTPS existe parce que poser une clé de déploiement
# exige les droits ADMIN sur le dépôt — que l'équipe qui déploie n'a pas
# toujours, et c'est alors une impasse : Terraform crée la paire, personne ne
# peut poser la moitié publique, Flux ne clone jamais.

resource "tls_private_key" "deploy" {
  count     = local.use_ssh ? 1 : 0
  algorithm = "ED25519"
}

resource "kubernetes_secret" "git_auth" {
  metadata {
    name      = "flux-system"
    namespace = kubernetes_namespace.flux.metadata[0].name
  }

  data = local.use_ssh ? {
    identity       = tls_private_key.deploy[0].private_key_openssh
    "identity.pub" = tls_private_key.deploy[0].public_key_openssh
    known_hosts    = local.github_known_hosts
    } : {
    username = "git"
    password = var.https_token
  }

  type = "Opaque"
}

# ─── Valeurs propres à l'environnement ─────────────────────
#
# Le pont qui supprime l'étape manuelle de remplissage des gabarits : Terraform
# connaît chacune de ces valeurs, Flux les substitue dans les overlays au
# moment de la réconciliation. Les manifests portent `${web_role_arn}` et
# jamais un ARN réel, donc rien d'environnemental ne vit dans git.
resource "kubernetes_config_map" "cluster_vars" {
  metadata {
    name      = "cluster-vars"
    namespace = kubernetes_namespace.flux.metadata[0].name
  }

  data = var.substitutions
}

# Les valeurs substituables qui sont, elles, des secrets — le jeton que
# l'ingress exige pour prouver qu'une requête vient bien du CDN. Un ConfigMap
# est lisible par quiconque a un accès en lecture au namespace ; un Secret
# suffit à ne pas l'afficher dans un `kubectl describe`.
resource "kubernetes_secret" "cluster_secrets" {
  count = length(var.secret_substitutions) == 0 ? 0 : 1

  metadata {
    name      = "cluster-secrets"
    namespace = kubernetes_namespace.flux.metadata[0].name
  }

  data = var.secret_substitutions
  type = "Opaque"
}

resource "helm_release" "sync" {
  name       = "flux2-sync"
  repository = "https://fluxcd-community.github.io/helm-charts"
  chart      = "flux2-sync"
  version    = var.flux_sync_chart_version
  namespace  = kubernetes_namespace.flux.metadata[0].name

  set = [
    {
      name  = "gitRepository.spec.url"
      value = local.repository_url
    },
    {
      name  = "gitRepository.spec.ref.branch"
      value = var.branch
    },
    {
      name  = "gitRepository.spec.interval"
      value = "2m"
    },
    {
      name  = "gitRepository.spec.secretRef.name"
      value = kubernetes_secret.git_auth.metadata[0].name
    },
    {
      # Racine de la réconciliation : ce chemin ne contient que les
      # Kustomization de l'environnement, qui pointent à leur tour sur la
      # plateforme, les émetteurs et les overlays applicatifs.
      name  = "kustomization.spec.path"
      value = "./infra/k8s/flux/${var.env}"
    },
    {
      name  = "kustomization.spec.interval"
      value = "2m"
    },
    {
      name  = "kustomization.spec.prune"
      value = "true"
    },
  ]

  depends_on = [
    helm_release.flux,
    kubernetes_secret.git_auth,
    kubernetes_config_map.cluster_vars,
  ]
}

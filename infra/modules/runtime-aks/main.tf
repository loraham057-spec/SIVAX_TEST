/**
 * Module runtime-aks — managed Kubernetes runtime.
 *
 * Selected by `orchestrator = "aks"`. Exposes the same contract as
 * runtime-aca, so the surrounding infrastructure (network, database, cache,
 * Key Vault, Front Door, observability) is untouched by the choice.
 *
 * Design points that are decisions rather than defaults:
 *
 *  · Private cluster. The API server has no public address; the CI reaches it
 *    with `az aks command invoke`, which runs kubectl inside the cluster.
 *
 *  · Workload Identity, not secrets. Each Kubernetes ServiceAccount is
 *    federated to an Azure managed identity through the cluster OIDC issuer,
 *    so pods obtain Entra tokens with no Azure credential mounted anywhere.
 *
 *  · Egress through the shared NAT Gateway. `outbound_type =
 *    userAssignedNATGateway` keeps the outbound address identical to the
 *    Container Apps runtime — switching orchestrator must not invalidate an
 *    allow-list entry obtained from the ministry.
 *
 *  · Monitoring is layered, not duplicated. Container Insights (a DaemonSet)
 *    collects node and stdout telemetry once per node; the per-pod
 *    OpenTelemetry sidecars declared in k8s/ handle application traces and
 *    custom metrics, which are per-application concerns a node agent cannot
 *    infer. Managed Prometheus scrapes both.
 *
 *  · GitOps. Terraform creates the cluster and bootstraps Flux; it does not
 *    manage the manifests. Application state lives in k8s/, reconciled
 *    continuously — so a manual `kubectl edit` is reverted rather than
 *    silently kept.
 */

resource "azurerm_kubernetes_cluster" "main" {
  name                = var.names.aks
  resource_group_name = var.resource_group_name
  location            = var.location
  dns_prefix          = "${var.project}-${var.env}"
  tags                = var.tags

  # Free tier has no control-plane SLA; Standard adds the 99.95% uptime SLA for
  # ~65 USD/month. Driven by a variable so a tight budget can keep prod on Free.
  sku_tier = var.sku_tier

  kubernetes_version        = var.kubernetes_version
  automatic_upgrade_channel = "patch"
  node_os_upgrade_channel   = "NodeImage"

  private_cluster_enabled             = var.private_cluster_enabled
  private_cluster_public_fqdn_enabled = false

  # Workload identity: the whole reason no pod carries an Azure secret.
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  # Kubernetes-local accounts are disabled so every human and machine
  # authenticates through Entra and appears in the audit trail.
  local_account_disabled = true

  default_node_pool {
    name    = "system"
    vm_size = var.system_node_vm_size
    zones   = var.zone_redundant ? ["1", "2", "3"] : null

    # Autoscaled like the user pool when asked for. The system pool grows more
    # rarely — its tenants are the add-ons — but it does grow: Container
    # Insights, Cilium, CSI and Flux all scale with the cluster, and a fixed
    # single node makes a node failure an outage of CoreDNS rather than a
    # reschedule.
    auto_scaling_enabled = var.system_autoscaling_enabled
    node_count           = var.system_autoscaling_enabled ? null : var.system_node_count
    min_count            = var.system_autoscaling_enabled ? var.system_node_min_count : null
    max_count            = var.system_autoscaling_enabled ? var.system_node_max_count : null

    vnet_subnet_id = var.aks_subnet_id
    os_sku         = "AzureLinux"

    # Keeps application pods off the system pool, so a runaway workload cannot
    # starve CoreDNS or the metrics server.
    only_critical_addons_enabled = var.system_pool_dedicated

    # Toggling only_critical_addons_enabled — or the vm_size, the disk, the
    # subnet — is not an in-place update on AKS: the provider refuses the plan
    # outright unless it is told what to call the temporary pool it creates,
    # drains the current one into, and then renames back. Without this the
    # apply fails with "`temporary_name_for_rotation` must be specified",
    # which is exactly what blocked lifting the taint from the system pool.
    #
    # The rotation needs room for one extra pool for the duration, so the
    # regional vCPU quota has to have slack while it runs.
    temporary_name_for_rotation = "systemtmp"

    upgrade_settings {
      max_surge = "33%"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
    # Overlay: pods get their own CIDR outside the VNet, so the subnet only has
    # to fit the nodes. Without it a /23 would exhaust after a few dozen pods.
    network_plugin_mode = "overlay"
    pod_cidr            = var.pod_cidr
    service_cidr        = var.service_cidr
    dns_service_ip      = cidrhost(var.service_cidr, 10)

    # Cilium gives NetworkPolicy natively in the data plane.
    network_policy     = "cilium"
    network_data_plane = "cilium"

    load_balancer_sku = "standard"
    outbound_type     = "userAssignedNATGateway"
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = true
    admin_group_object_ids = var.admin_group_object_ids
  }

  # Key Vault secrets mounted through the CSI driver, rotated automatically.
  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"
  }

  # Event-driven autoscaling — the same role http scale rules play on ACA.
  workload_autoscaler_profile {
    keda_enabled = true
  }

  # Container Insights: one DaemonSet per node for stdout logs and node
  # metrics. The application-level telemetry comes from the pod sidecars.
  #
  # Désactivable, et ce n'est pas cosmétique : mesuré sur dev, la pile
  # ama / ama-metrics / ama-logs réserve 1470 mCPU, soit près de deux fois et
  # demie ce que demande l'application elle-même (600 mCPU). Sur un cluster
  # d'un seul nœud, c'est elle qui décide de la taille du nœud. On la garde en
  # production et on l'éteint là où elle coûte plus qu'elle ne rapporte.
  dynamic "oms_agent" {
    for_each = var.enable_container_insights ? [1] : []
    content {
      log_analytics_workspace_id      = var.log_analytics_workspace_id
      msi_auth_for_monitoring_enabled = true
    }
  }

  # Azure Managed Prometheus scrapes both the sidecars and the cluster.
  dynamic "monitor_metrics" {
    for_each = var.enable_container_insights ? [1] : []
    content {
      annotations_allowed = "*"
      labels_allowed      = "*"
    }
  }

  maintenance_window_auto_upgrade {
    frequency   = "Weekly"
    interval    = 1
    duration    = 4
    day_of_week = "Sunday"
    start_time  = "02:00"
    utc_offset  = "+00:00"
  }

  lifecycle {
    ignore_changes = [
      # The autoscaler owns the node count; Terraform must not fight it.
      default_node_pool[0].node_count,
      # Patch upgrades are applied by the platform on the channel above.
      kubernetes_version,
    ]
  }
}

# ─── User node pool ────────────────────────────────────────
#
# Application workloads live here, autoscaled. Separating it from the system
# pool is what makes `only_critical_addons_enabled` above meaningful.

resource "azurerm_kubernetes_cluster_node_pool" "user" {
  # Disabled on tiny environments (dev), where the system pool is made
  # schedulable (system_pool_dedicated = false) and runs the app itself.
  count = var.enable_user_pool ? 1 : 0

  name                  = "user"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = var.user_node_vm_size
  os_sku                = "AzureLinux"
  zones                 = var.zone_redundant ? ["1", "2", "3"] : null
  vnet_subnet_id        = var.aks_subnet_id
  tags                  = var.tags

  # Autoscale optionnel, comme le pool système : sur un environnement calibré au
  # vCPU près, un pool qui grandit tout seul prend la place que l'autre
  # environnement attend, et l'échec se manifeste ailleurs — c'est exactement
  # ce qui a bloqué la création du pool applicatif de prod.
  auto_scaling_enabled = var.user_autoscaling_enabled
  node_count           = var.user_autoscaling_enabled ? null : var.user_node_count
  min_count            = var.user_autoscaling_enabled ? var.user_node_min_count : null
  max_count            = var.user_autoscaling_enabled ? var.user_node_max_count : null

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    ignore_changes = [node_count]
  }
}

# ─── Registry access ───────────────────────────────────────
#
# The kubelet identity pulls images; no registry credential is stored in a
# Kubernetes secret.

resource "azurerm_role_assignment" "acr_pull" {
  count                = var.grant_acr_pull ? 1 : 0
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}

# ─── Deployer access ───────────────────────────────────────
#
# What lets the pipeline actually reach the cluster. The API server is private
# on staging and prod, so k8s-deploy runs kubectl through `az aks command
# invoke`; that needs the control-plane run-command permission, which the
# Cluster User Role carries. The pod run-command spawns already runs as
# cluster-admin, so the RBAC Writer assignment is the floor for anything that
# talks to the API directly instead — necessary because local_account_disabled
# and azure_rbac_enabled mean every in-cluster action is authorised through
# Entra, with no local admin kubeconfig to fall back on.
#
# Today the deployer is subscription Contributor, which already implies
# run-command; making the grant explicit here keeps the deploy working if that
# broad role is ever narrowed, and states the dependency where it belongs.

resource "azurerm_role_assignment" "deployer_cluster_user" {
  count                = var.deployer_principal_id == "" ? 0 : 1
  scope                = azurerm_kubernetes_cluster.main.id
  role_definition_name = "Azure Kubernetes Service Cluster User Role"
  principal_id         = var.deployer_principal_id
}

resource "azurerm_role_assignment" "deployer_rbac_writer" {
  count                = var.deployer_principal_id == "" ? 0 : 1
  scope                = azurerm_kubernetes_cluster.main.id
  role_definition_name = "Azure Kubernetes Service RBAC Writer"
  principal_id         = var.deployer_principal_id
}

# RBAC Writer ne porte que les types intégrés de Kubernetes : ni les ressources
# à portée cluster, ni les définitions personnalisées. Or le déploiement en a
# besoin des deux — k8s-deploy annote gitrepositories et kustomizations dans
# flux-system pour réveiller Flux, et diagnostiquer une réconciliation qui ne
# part pas suppose de pouvoir les lire. Sans ce rôle, l'étape « Reconcile »
# échoue en Forbidden et le déploiement attend un déploiement qui n'arrivera
# jamais.
resource "azurerm_role_assignment" "deployer_rbac_cluster_admin" {
  count                = var.deployer_principal_id == "" ? 0 : 1
  scope                = azurerm_kubernetes_cluster.main.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = var.deployer_principal_id
}

# The AKS control-plane identity attaches the pre-created public IP to the
# ingress load balancer; that IP lives outside the node resource group, so the
# identity needs Network Contributor on it explicitly.
resource "azurerm_role_assignment" "ingress_ip" {
  count                = var.grant_ingress_ip_role ? 1 : 0
  scope                = var.ingress_pip_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}

# Same identity, second scope, and it is not optional: the cluster runs in a
# BYO subnet, so provisioning the load balancer behind a Service of type
# LoadBalancer is a write on the node VMSS *linked to* that subnet. Azure
# checks `Microsoft.Network/virtualNetworks/subnets/join/action` on the linked
# scope, which the node resource group's built-in grants do not cover.
#
# Without this the ingress controller's Service stays <pending> for ever —
# SyncLoadBalancerFailed / LinkedAuthorizationFailed — the ingress never gets a
# public address, and every route into the platform is dead even though the
# pods themselves are healthy.
resource "azurerm_role_assignment" "cluster_subnet_join" {
  scope                = var.aks_subnet_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}

# ─── Workload Identity federation ──────────────────────────
#
# One federated credential per workload, binding a Kubernetes ServiceAccount to
# an Azure managed identity. The `subject` must match the ServiceAccount
# declared in k8s/base exactly.

resource "azurerm_federated_identity_credential" "workloads" {
  for_each = var.workload_identities

  name                = "fic-${var.env}-${each.key}"
  resource_group_name = var.resource_group_name
  parent_id           = each.value
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.main.oidc_issuer_url
  subject             = "system:serviceaccount:${var.kubernetes_namespace}:${each.key}"
}

# ─── GitOps ────────────────────────────────────────────────
#
# Flux reconciles k8s/overlays/<env> continuously. Terraform bootstraps it and
# then stays out of the way: manifests are not Terraform's business, and a
# change made with kubectl is reverted on the next reconciliation.

# ─── GitOps credentials ────────────────────────────────────

locals {
  # Pinning GitHub's host key is what makes the SSH connection meaningful:
  # without it Flux would accept any server presenting itself as github.com.
  github_known_hosts = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
}

resource "tls_private_key" "gitops" {
  count     = var.gitops_use_deploy_key ? 1 : 0
  algorithm = "ED25519"
}

resource "azurerm_kubernetes_cluster_extension" "flux" {
  count          = var.gitops_enabled ? 1 : 0
  name           = "flux"
  cluster_id     = azurerm_kubernetes_cluster.main.id
  extension_type = "microsoft.flux"

  # ORDRE SIGNIFICATIF. À l'installation, AKS crée une identité managée pour
  # l'extension et l'attache aux pools de nœuds ALORS EXISTANTS. Un pool ajouté
  # après coup ne la reçoit pas — et si l'agent y est planifié, il interroge
  # IMDS pour une identité absente du nœud et échoue sur
  # « the requested identity isn't assigned to this resource ». L'agent ne
  # récupère alors jamais sa configuration, aucun GitRepository n'est créé, et
  # le cluster reste vide sans que rien ne le signale.
  #
  # Installer l'extension après le pool applicatif rend l'attachement complet
  # dès le premier apply, et donc l'environnement reconstructible sans reprise
  # manuelle.
  depends_on = [azurerm_kubernetes_cluster_node_pool.user]
}

resource "azurerm_kubernetes_flux_configuration" "main" {
  count      = var.gitops_enabled ? 1 : 0
  name       = var.project
  cluster_id = azurerm_kubernetes_cluster.main.id
  namespace  = "flux-system"
  scope      = "cluster"

  git_repository {
    url                      = var.gitops_repository_url
    reference_type           = "branch"
    reference_value          = var.gitops_branch
    sync_interval_in_seconds = 120
    timeout_in_seconds       = 600

    # A private repository needs credentials, or Flux reports the source as
    # Non-Compliant and nothing is ever reconciled. A read-only deploy key is
    # the narrowest option: scoped to this one repository, unlike a PAT which
    # carries the whole account.
    #
    # The key pair is generated by Terraform, so the private half never exists
    # outside the state and the cluster. The public half is an output — add it
    # to the repository as a deploy key (Settings → Deploy keys), read-only.
    ssh_private_key_base64 = (var.gitops_use_deploy_key && var.gitops_https_token == "") ? base64encode(tls_private_key.gitops[0].private_key_openssh) : null
    ssh_known_hosts_base64 = (var.gitops_use_deploy_key && var.gitops_https_token == "") ? base64encode(local.github_known_hosts) : null

    # Variante HTTPS par jeton. Une clé de déploiement est plus étroite, mais
    # l'enregistrer sur le dépôt exige les droits ADMIN — ce que n'a pas
    # forcément l'équipe qui déploie, et c'est alors un cul-de-sac : Terraform
    # crée la paire, personne ne peut poser la moitié publique, Flux ne clone
    # jamais et le cluster reste vide.
    #
    # Un jeton avec le droit de push suffit ici, et il a l'avantage décisif de
    # rendre le bootstrap entièrement reproductible : plus aucun geste manuel
    # entre `terraform apply` et un cluster qui réconcilie.
    https_user       = var.gitops_https_token != "" ? "git" : null
    https_key_base64 = var.gitops_https_token != "" ? base64encode(var.gitops_https_token) : null
  }

  # Platform components shared by every cluster and independent of the
  # environment: the ingress controller lives here. Reconciled on its own path
  # so it is not swept into the app overlays' namespace, and left without a
  # dependency edge to "apps" — the workloads run whether or not the edge is up,
  # and coupling them would let a controller hiccup block an application deploy.
  kustomizations {
    name                       = "platform"
    path                       = "./infra/k8s/platform"
    sync_interval_in_seconds   = 120
    retry_interval_in_seconds  = 60
    garbage_collection_enabled = true

    # The ingress Service adopts the pre-created public IP by name; Flux fills
    # it here so the manifest carries no environment-specific value.
    post_build {
      substitute = {
        ingress_pip_name = var.ingress_pip_name
        ingress_pip_rg   = var.resource_group_name
        acme_email       = var.acme_email
      }
    }
  }

  # Les émetteurs ACME, après la plateforme : leurs types viennent des CRD que
  # la release cert-manager installe. `depends_on` est ce qui rend l'ordre
  # explicite — sans lui, Flux valide les deux lots en parallèle et celui des
  # émetteurs échoue systématiquement au dry-run.
  kustomizations {
    name                       = "platform-issuers"
    path                       = "./infra/k8s/platform-issuers"
    sync_interval_in_seconds   = 120
    retry_interval_in_seconds  = 60
    garbage_collection_enabled = true
    depends_on                 = ["platform"]

    post_build {
      substitute = {
        acme_email = var.acme_email
        # Nom public : porte la réécriture CoreDNS qui rend l'auto-vérification
        # ACME possible malgré l'absence de hairpin sur Azure Load Balancer.
        ingress_host = var.ingress_host
      }
    }
  }

  kustomizations {
    name                      = "apps"
    path                      = "./infra/k8s/overlays/${var.env}"
    sync_interval_in_seconds  = 120
    retry_interval_in_seconds = 60
    # Removing a manifest from git removes the object from the cluster.
    garbage_collection_enabled = true

    # This is the bridge that removes the manual placeholder step: Terraform
    # knows every one of these values, and Flux substitutes them into the
    # overlay at reconcile time. The overlay ships `${web_client_id}` etc. and
    # never a real id, so nothing environment-specific lives in git.
    post_build {
      substitute = var.app_substitutions
    }
  }

  depends_on = [azurerm_kubernetes_cluster_extension.flux]
}

# ─── Diagnostics ───────────────────────────────────────────
#
# Control-plane logs. `kube-audit-admin` rather than the full `kube-audit`:
# the admin subset excludes read-only calls, which are the overwhelming bulk of
# the volume and the least useful.

resource "azurerm_monitor_diagnostic_setting" "aks" {
  name                       = "diag-${var.names.aks}"
  target_resource_id         = azurerm_kubernetes_cluster.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "kube-apiserver"
  }

  enabled_log {
    category = "kube-controller-manager"
  }

  enabled_log {
    category = "kube-audit-admin"
  }

  enabled_log {
    category = "cluster-autoscaler"
  }

  enabled_log {
    category = "guard" # Entra authentication decisions
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

/**
 * Module runtime-eks — Kubernetes managé, pendant AWS de runtime-aks.
 *
 * Points de conception qui sont des décisions, pas des valeurs par défaut :
 *
 *  · IRSA plutôt que des secrets. Chaque ServiceAccount est associé à un rôle
 *    IAM par le fournisseur OIDC du cluster (module identity), donc aucun pod
 *    ne porte de clé d'accès AWS. C'est le strict équivalent de la fédération
 *    Workload Identity côté Azure, et les noms de ServiceAccount y sont tout
 *    aussi porteurs : ils forment la condition `sub` de la politique de
 *    confiance.
 *
 *  · Sortie par la NAT partagée. Les nœuds vivent dans les sous-réseaux privés
 *    du module network, donc l'adresse vue par SNIS RDC ne dépend ni du nombre
 *    de nœuds ni de leur remplacement.
 *
 *  · Le plan de contrôle journalise ce qui sert à une enquête (api, audit,
 *    authenticator) et pas le reste : `audit` est le pendant du
 *    kube-audit-admin d'AKS, et c'est le poste de coût principal des journaux.
 *
 *  · Les add-ons sont posés ici, les manifests applicatifs par Flux (module
 *    gitops). Terraform amorce, il ne gère pas les manifests : un `kubectl
 *    edit` manuel est réconcilié, pas conservé.
 *
 *  · Pas de contrôleur ALB. L'ingress reste ingress-nginx exposé par un NLB
 *    (Service de type LoadBalancer, contrôleur intégré au plan de contrôle),
 *    qui adopte les IP élastiques pré-allouées par le module network. C'est ce
 *    qui garde les manifests de k8s/platform valables et l'adresse d'entrée
 *    stable.
 */

data "aws_partition" "current" {}

# ─── Journaux du plan de contrôle ──────────────────────────
#
# Créé avant le cluster : sinon EKS crée le groupe lui-même, sans rétention, et
# les journaux s'accumulent indéfiniment.
resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/eks/${var.names.eks}/cluster"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ─── Rôle du plan de contrôle ──────────────────────────────

data "aws_iam_policy_document" "cluster_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "role-eks-cluster-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  for_each = toset([
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy",
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSVPCResourceController",
  ])
  role       = aws_iam_role.cluster.name
  policy_arn = each.value
}

# ─── Cluster ───────────────────────────────────────────────

resource "aws_eks_cluster" "main" {
  name     = var.names.eks
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version
  tags     = var.tags

  vpc_config {
    subnet_ids = var.private_subnet_ids

    # L'accès privé est toujours ouvert ; le public est ce que l'on ferme en
    # production. Fermé, le pipeline doit atteindre l'API depuis le VPC (agent
    # auto-hébergé, ou session SSM) — c'est le pendant de `az aks command
    # invoke` côté Azure, et ce n'est pas gratuit en complexité : dev le laisse
    # ouvert pour que kubectl fonctionne sans rebond.
    endpoint_private_access = true
    endpoint_public_access  = !var.private_cluster_enabled
    public_access_cidrs     = var.private_cluster_enabled ? null : var.api_allowed_cidrs
  }

  # API_AND_CONFIG_MAP : les entrées d'accès (aws_eks_access_entry) remplacent
  # l'édition du ConfigMap aws-auth, qui est le geste manuel le plus classique
  # d'un cluster EKS — et celui qui casse le cluster quand il est raté.
  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  enabled_cluster_log_types = var.enabled_log_types

  # Chiffrement des Secrets Kubernetes par une clé KMS du compte, quand une clé
  # est fournie. Sans elle, etcd chiffre déjà au repos avec une clé AWS ; la
  # clé propre ajoute la traçabilité des déchiffrements et la révocation.
  dynamic "encryption_config" {
    for_each = var.secrets_kms_key_arn == "" ? [] : [var.secrets_kms_key_arn]
    content {
      provider {
        key_arn = encryption_config.value
      }
      resources = ["secrets"]
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster,
    aws_cloudwatch_log_group.cluster,
  ]

  lifecycle {
    ignore_changes = [
      # Les correctifs mineurs sont appliqués par la plateforme ; Terraform ne
      # doit pas les défaire au plan suivant.
      version,
    ]
  }
}

# ─── Fournisseur OIDC ──────────────────────────────────────
#
# La racine d'IRSA : sans lui, aucun ServiceAccount ne peut échanger son jeton
# projeté contre des identifiants IAM.

data "tls_certificate" "oidc" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "main" {
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
  tags            = var.tags
}

# ─── Rôle des nœuds ────────────────────────────────────────

data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "role-eks-node-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKS_CNI_Policy",
    # Le tirage des images se fait avec le rôle du nœud : aucun identifiant de
    # registre n'est stocké dans un Secret Kubernetes.
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    # Session Manager : entrer sur un nœud sans ouvrir SSH ni bastion.
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.node.name
  policy_arn = each.value
}

# ─── Groupes de nœuds ──────────────────────────────────────

# Système : les add-ons (CoreDNS, CSI, KEDA, Flux, l'agent CloudWatch). La
# souillure CriticalAddonsOnly est le pendant de only_critical_addons_enabled
# côté AKS — elle garde les pods applicatifs hors de ce groupe pour qu'une
# charge emballée ne prive pas CoreDNS de CPU. En dev, où le groupe applicatif
# n'existe pas, elle est désactivée et l'application tourne ici.
resource "aws_eks_node_group" "system" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = var.names.node_group_sys
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids
  version         = var.kubernetes_version
  tags            = var.tags

  instance_types = [var.system_node_instance_type]
  capacity_type  = "ON_DEMAND"
  disk_size      = var.node_disk_size

  # desired_size DOIT rester dans [min_size, max_size] : EKS refuse la creation
  # sur « minSize can't be greater than desiredSize » sinon. Le cas se produit
  # des qu'on autoscale avec un plancher superieur au nombre de noeuds de
  # depart — ce qui est exactement la configuration de prod.
  scaling_config {
    desired_size = var.system_autoscaling_enabled ? max(var.system_node_count, var.system_node_min_count) : var.system_node_count
    min_size     = var.system_autoscaling_enabled ? var.system_node_min_count : var.system_node_count
    max_size     = var.system_autoscaling_enabled ? var.system_node_max_count : var.system_node_count
  }

  # 33 % comme le max_surge d'AKS : une mise à jour remplace au tiers, ce qui
  # laisse le service debout sans exiger le double du quota.
  update_config {
    max_unavailable_percentage = 33
  }

  labels = {
    "node-role" = "system"
  }

  dynamic "taint" {
    for_each = var.system_pool_dedicated ? [1] : []
    content {
      key    = "CriticalAddonsOnly"
      value  = "true"
      effect = "NO_SCHEDULE"
    }
  }

  depends_on = [aws_iam_role_policy_attachment.node]

  lifecycle {
    # L'autoscaler possède la taille effective ; Terraform ne doit pas la lui
    # disputer à chaque plan.
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# Applicatif : web, ai, leurs sidecars, les jobs ETL.
resource "aws_eks_node_group" "user" {
  count = var.enable_user_pool ? 1 : 0

  cluster_name    = aws_eks_cluster.main.name
  node_group_name = var.names.node_group_user
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids
  version         = var.kubernetes_version
  tags            = var.tags

  instance_types = [var.user_node_instance_type]
  capacity_type  = var.user_node_capacity_type
  disk_size      = var.node_disk_size

  # Meme regle que pour le groupe systeme : desired_size dans [min, max].
  scaling_config {
    desired_size = var.user_autoscaling_enabled ? max(var.user_node_count, var.user_node_min_count) : var.user_node_count
    min_size     = var.user_autoscaling_enabled ? var.user_node_min_count : var.user_node_count
    max_size     = var.user_autoscaling_enabled ? var.user_node_max_count : var.user_node_count
  }

  update_config {
    max_unavailable_percentage = 33
  }

  labels = {
    "node-role" = "user"
  }

  depends_on = [aws_iam_role_policy_attachment.node]

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# ─── Entrée depuis Internet ────────────────────────────────
#
# Le NLB conserve l'adresse du client (mode instance), donc le trafic arrive
# sur le nodePort du Service avec l'IP source réelle. Le groupe de sécurité du
# cluster, porté par les nœuds, est ce qui décide qui peut atteindre ce port —
# c'est le pendant exact du NSG côté Azure.
#
# Avec CloudFront devant, seule la liste de préfixes managée du CDN est
# autorisée : l'ingress devient injoignable en direct même si son adresse est
# publique. Sans CDN, il faut ouvrir 80/443 à Internet, faute de quoi rien
# n'atteint le cluster — c'est la même bascule que `frontdoor_enabled` côté
# Azure, et l'oublier donne un cluster sain que personne ne joint.

data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = var.restrict_ingress_to_cdn ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "nodeport_internet" {
  count             = var.restrict_ingress_to_cdn ? 0 : 1
  security_group_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 30000
  to_port           = 32767
  ip_protocol       = "tcp"
  # AWS restreint le jeu de caracteres d'une description de regle :
  # l'apostrophe en est exclue, et le refus est un 400 sans autre indice.
  description = "Trafic ingress (nodePort) depuis Internet"
}

# Les sondes de sante du NLB partent de ses interfaces DANS le VPC, pas de
# CloudFront. Sans cette regle, restreindre a la liste de prefixes du CDN les
# fait tomber : le load balancer considere tous les noeuds hors service et cesse
# d'acheminer, alors que l'ingress et les pods sont parfaitement sains. C'est le
# meme piege que les sondes d'Azure Load Balancer, qui arrivaient de
# 168.63.129.16 et tombaient dans le DenyInternetInbound du NSG.
resource "aws_vpc_security_group_ingress_rule" "nodeport_healthcheck" {
  count             = var.restrict_ingress_to_cdn ? 1 : 0
  security_group_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 30000
  to_port           = 32767
  ip_protocol       = "tcp"
  description       = "Sondes de sante du NLB depuis le VPC"
}

resource "aws_vpc_security_group_ingress_rule" "nodeport_cdn" {
  count             = var.restrict_ingress_to_cdn ? 1 : 0
  security_group_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront[0].id
  from_port         = 30000
  to_port           = 32767
  ip_protocol       = "tcp"
  description       = "Trafic ingress (nodePort) depuis CloudFront uniquement"
}

# ─── Accès humain et pipeline ──────────────────────────────
#
# Le pendant d'`admin_group_object_ids` et des rôles RBAC AKS : un principal
# IAM déclaré ici obtient un accès administrateur au cluster, sans passer par
# aws-auth ni par un kubeconfig local.

resource "aws_eks_access_entry" "admins" {
  for_each      = toset(var.admin_principal_arns)
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = each.value
  type          = "STANDARD"
  tags          = var.tags
}

resource "aws_eks_access_policy_association" "admins" {
  for_each      = aws_eks_access_entry.admins
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

# Le pipeline déploie et diagnostique : il annote les GitRepository et les
# Kustomization de flux-system pour réveiller Flux, ce qu'aucune politique
# restreinte aux types intégrés ne couvre. Même constat que côté AKS, où RBAC
# Writer ne suffisait pas.
resource "aws_eks_access_entry" "deployer" {
  count         = var.deployer_principal_arn == "" ? 0 : 1
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = var.deployer_principal_arn
  type          = "STANDARD"
  tags          = var.tags
}

resource "aws_eks_access_policy_association" "deployer" {
  count         = var.deployer_principal_arn == "" ? 0 : 1
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = var.deployer_principal_arn
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.deployer]
}

# ─── Acces par la console AWS ──────────────────────────────
#
# L'onglet « Ressources » de la console EKS appelle le serveur d'API sous
# l'identite de la personne connectee. Il faut donc que CETTE identite ait une
# entree d'acces — et c'est la que se trouve le piege : le compte ROOT ne peut
# pas en avoir. EKS refuse d'associer des droits Kubernetes au principal root,
# quelle que soit la configuration. La console repond alors « Unauthorized »
# sur l'onglet Ressources, alors que tout le reste de la console fonctionne et
# que kubectl marche parfaitement depuis un poste — un symptome qui se lit
# comme un cluster casse, sans l'etre.
#
# Ce role est la reponse : le root (ou n'importe quel utilisateur IAM du
# compte) l'endosse depuis la console — menu du compte, « Changer de role » —
# et navigue alors sous une identite que EKS sait reconnaitre.
#
# Il porte volontairement les droits d'administration du cluster : la demande
# est de LISTER ET MODIFIER les ressources. Pour de la lecture seule, remplacer
# la politique par AmazonEKSAdminViewPolicy.

data "aws_caller_identity" "current" {}

locals {
  console_role_trusted = length(var.console_role_trusted_principal_arns) > 0 ? var.console_role_trusted_principal_arns : ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
}

data "aws_iam_policy_document" "console_assume" {
  count = var.create_console_role ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = local.console_role_trusted
    }
  }
}

resource "aws_iam_role" "console" {
  count              = var.create_console_role ? 1 : 0
  name               = "${var.name_prefix}-eks-console"
  description        = "Endosse depuis la console AWS pour voir et modifier les ressources Kubernetes du cluster."
  assume_role_policy = data.aws_iam_policy_document.console_assume[0].json
  tags               = var.tags
}

# Le minimum dont la console a besoin pour afficher l'onglet Ressources :
# decrire le cluster, et parler au serveur d'API en son nom. Les droits
# Kubernetes eux-memes viennent de l'entree d'acces plus bas, pas d'ici.
resource "aws_iam_role_policy" "console" {
  count = var.create_console_role ? 1 : 0
  name  = "eks-console"
  role  = aws_iam_role.console[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster",
          "eks:ListClusters",
          "eks:AccessKubernetesApi",
          "eks:ListNodegroups",
          "eks:DescribeNodegroup",
          "eks:ListAddons",
          "eks:DescribeAddon",
          "eks:ListAccessEntries",
          "eks:DescribeAccessEntry",
          "eks:ListAssociatedAccessPolicies",
          "eks:ListIdentityProviderConfigs",
          "eks:ListUpdates",
          "eks:DescribeUpdate",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_eks_access_entry" "console" {
  count         = var.create_console_role ? 1 : 0
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.console[0].arn
  type          = "STANDARD"
  tags          = var.tags
}

resource "aws_eks_access_policy_association" "console" {
  count         = var.create_console_role ? 1 : 0
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.console[0].arn
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.console]
}

# ─── Add-ons managés ───────────────────────────────────────

resource "aws_eks_addon" "core" {
  for_each = toset(["vpc-cni", "kube-proxy", "coredns"])

  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = each.value
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  # CoreDNS a besoin d'un nœud pour démarrer : sans cette dépendance, l'add-on
  # est posé sur un cluster vide et reste en DEGRADED jusqu'au premier nœud.
  depends_on = [aws_eks_node_group.system]
}

# Pilote EBS : requis dès qu'un PersistentVolumeClaim existe (le Redis en
# cluster, une file d'attente, un cache d'artefacts). Sans lui le PVC reste
# Pending sans autre message que « no volume plugin matched ».
resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "aws-ebs-csi-driver"
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.system]
}

# metrics-server : intégré à AKS, absent d'EKS. Sans lui, aucun HPA ne calcule
# rien et l'autoscaling applicatif est un décor.
resource "aws_eks_addon" "metrics_server" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "metrics-server"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.system]
}

# Container Insights. Même arbitrage que côté AKS : l'agent réserve des
# ressources qui, sur un cluster d'un ou deux nœuds, pèsent plus que
# l'application elle-même. Les traces applicatives passent de toute façon par
# les sidecars OpenTelemetry.
resource "aws_eks_addon" "cloudwatch" {
  count = var.enable_container_insights ? 1 : 0

  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "amazon-cloudwatch-observability"
  service_account_role_arn    = aws_iam_role.cloudwatch_agent[0].arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.system]
}

# ─── Rôles IRSA des composants d'infrastructure ────────────

locals {
  oidc_issuer_host = replace(aws_iam_openid_connect_provider.main.url, "https://", "")
}

data "aws_iam_policy_document" "irsa_ebs_csi" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.main.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "role-ebs-csi-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.irsa_ebs_csi.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

data "aws_iam_policy_document" "irsa_cloudwatch" {
  count = var.enable_container_insights ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.main.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:sub"
      values   = ["system:serviceaccount:amazon-cloudwatch:cloudwatch-agent"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch_agent" {
  count              = var.enable_container_insights ? 1 : 0
  name               = "role-cwagent-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.irsa_cloudwatch[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  count      = var.enable_container_insights ? 1 : 0
  role       = aws_iam_role.cloudwatch_agent[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# ─── Autoscaler de cluster ─────────────────────────────────
#
# EKS ne fournit pas l'autoscaler ; il se déploie et s'autorise explicitement.
# Il ne sert à rien tant qu'aucun groupe de nœuds n'est autoscalé, d'où la
# condition.

locals {
  autoscaler_enabled = var.system_autoscaling_enabled || (var.enable_user_pool && var.user_autoscaling_enabled)
}

data "aws_iam_policy_document" "irsa_autoscaler" {
  count = local.autoscaler_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.main.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:sub"
      values   = ["system:serviceaccount:kube-system:cluster-autoscaler"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "autoscaler" {
  count              = local.autoscaler_enabled ? 1 : 0
  name               = "role-autoscaler-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.irsa_autoscaler[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "autoscaler" {
  count = local.autoscaler_enabled ? 1 : 0
  name  = "cluster-autoscaler"
  role  = aws_iam_role.autoscaler[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeLaunchConfigurations",
          "autoscaling:DescribeScalingActivities",
          "autoscaling:DescribeTags",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplateVersions",
          "eks:DescribeNodegroup",
        ]
        Resource = "*"
      },
      {
        # Borné aux groupes de ce cluster : un autoscaler compromis ne doit pas
        # pouvoir éteindre les nœuds d'un autre environnement.
        Effect = "Allow"
        Action = [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:TerminateInstanceInAutoScalingGroup",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/kubernetes.io/cluster/${var.names.eks}" = "owned"
          }
        }
      },
    ]
  })
}

resource "helm_release" "cluster_autoscaler" {
  count = local.autoscaler_enabled ? 1 : 0

  name       = "cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  version    = var.chart_versions.cluster_autoscaler
  namespace  = "kube-system"

  set = [
    {
      name  = "autoDiscovery.clusterName"
      value = aws_eks_cluster.main.name
    },
    {
      name  = "awsRegion"
      value = var.region
    },
    {
      name  = "rbac.serviceAccount.name"
      value = "cluster-autoscaler"
    },
    {
      name  = "rbac.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
      value = aws_iam_role.autoscaler[0].arn
    },
    {
      name  = "extraArgs.balance-similar-node-groups"
      value = "true"
    },
  ]

  depends_on = [aws_eks_addon.core]
}

# ─── KEDA ──────────────────────────────────────────────────
#
# Les ScaledObject de k8s/base/autoscaling.yaml en dépendent : sans KEDA, ces
# objets sont refusés par l'API et l'overlay entier échoue à se réconcilier.
resource "helm_release" "keda" {
  name             = "keda"
  repository       = "https://kedacore.github.io/charts"
  chart            = "keda"
  version          = var.chart_versions.keda
  namespace        = "keda"
  create_namespace = true

  depends_on = [aws_eks_addon.core]
}

# ─── Secrets Store CSI ─────────────────────────────────────
#
# Le pendant du fournisseur Key Vault d'AKS : le pilote monte les secrets
# d'AWS Secrets Manager dans le pod et les recopie dans un Secret Kubernetes
# (syncSecret), ce que consomment les manifests par `envFrom`. La rotation est
# active avec la même période que côté Azure — cinq minutes.
resource "helm_release" "secrets_store_csi" {
  name       = "secrets-store-csi-driver"
  repository = "https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts"
  chart      = "secrets-store-csi-driver"
  version    = var.chart_versions.secrets_store_csi
  namespace  = "kube-system"

  set = [
    {
      name  = "syncSecret.enabled"
      value = "true"
    },
    {
      name  = "enableSecretRotation"
      value = "true"
    },
    {
      name  = "rotationPollInterval"
      value = "5m"
    },
  ]

  depends_on = [aws_eks_addon.core]
}

resource "helm_release" "secrets_store_aws_provider" {
  name       = "secrets-provider-aws"
  repository = "https://aws.github.io/secrets-store-csi-driver-provider-aws"
  chart      = "secrets-store-csi-driver-provider-aws"
  version    = var.chart_versions.secrets_store_aws_provider
  namespace  = "kube-system"

  depends_on = [helm_release.secrets_store_csi]
}

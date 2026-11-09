output "cluster_name" {
  description = "Nom du cluster, pour `aws eks update-kubeconfig`."
  value       = aws_eks_cluster.main.name
}

output "cluster_arn" {
  description = "ARN du cluster."
  value       = aws_eks_cluster.main.arn
}

output "cluster_endpoint" {
  description = "Point de terminaison du serveur d'API."
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_ca_certificate" {
  description = "Autorité de certification du cluster, encodée en base64."
  value       = aws_eks_cluster.main.certificate_authority[0].data
}

output "cluster_security_group_id" {
  description = "Groupe de sécurité du cluster, porté par les nœuds."
  value       = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
}

output "oidc_provider_arn" {
  description = "Fournisseur OIDC — racine des rôles IRSA."
  value       = aws_iam_openid_connect_provider.main.arn
}

output "oidc_issuer_url" {
  description = "URL de l'émetteur OIDC du cluster."
  value       = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

output "node_role_arn" {
  description = "Rôle IAM des nœuds — c'est lui qui tire les images depuis ECR."
  value       = aws_iam_role.node.arn
}

output "node_role_name" {
  description = "Nom du rôle IAM des nœuds."
  value       = aws_iam_role.node.name
}

# Les charges applicatives ne doivent pas être planifiées avant que le pilote
# de secrets et KEDA existent, sinon le premier rapprochement de Flux échoue
# sur des types inconnus. Cette sortie donne au module gitops une dépendance à
# laquelle s'accrocher.
output "addons_ready" {
  description = "Jeton de dépendance : vrai une fois les add-ons et les charts d'infrastructure posés."
  value = alltrue([
    helm_release.keda.status == "deployed",
    helm_release.secrets_store_aws_provider.status == "deployed",
  ])
}

output "console_role_arn" {
  description = "Role a endosser depuis la console AWS pour l'onglet Ressources. Vide quand il n'est pas cree."
  value       = var.create_console_role ? aws_iam_role.console[0].arn : ""
}

output "node_autoscaling_groups" {
  description = <<-DESC
    Groupes d'auto-scaling des noeuds, indexes par POOL et non par nom.

    Une map a cles statiques, et c'est ce qui compte : le nom d'un groupe
    d'auto-scaling n'existe qu'apres l'apply, et un `for_each` construit sur ces
    noms refuse tout plan des qu'un groupe de noeuds doit etre remplace — un
    changement de type d'instance, de disque ou de sous-reseau suffit. Avec les
    cles fixees dans le code et les valeurs resolues a l'apply, le plan reste
    calculable dans tous les cas.
  DESC
  value = merge(
    { system = one(aws_eks_node_group.system.resources[0].autoscaling_groups[*].name) },
    var.enable_user_pool ? { user = one(aws_eks_node_group.user[0].resources[0].autoscaling_groups[*].name) } : {},
  )
}

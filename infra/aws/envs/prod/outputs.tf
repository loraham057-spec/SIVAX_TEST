output "public_url" {
  description = "URL publique de l'environnement."
  value       = module.stack.public_url
}

output "egress_ips" {
  description = "IP de sortie fixes, pour l'allow-list SNIS RDC."
  value       = module.stack.egress_ips
}

output "ingress_ips" {
  description = "IP d'ingress — cibles des enregistrements A."
  value       = module.stack.ingress_ips
}

output "registry_host" {
  description = "Hôte du registre, consommé par le pipeline de construction."
  value       = module.stack.registry_host
}

output "ecr_repository_urls" {
  description = "URL des dépôts d'images."
  value       = module.stack.ecr_repository_urls
}

output "assets_base_url" {
  description = "URL de base des actifs statiques."
  value       = module.stack.assets_base_url
}

output "cluster_name" {
  description = "Cluster EKS, pour `aws eks update-kubeconfig`."
  value       = module.stack.cluster_name
}

output "secret_prefix" {
  description = "Préfixe des secrets, référencé par le SecretProviderClass."
  value       = module.stack.secret_prefix
}

output "workload_role_arns" {
  description = "ARN des rôles IRSA pour les annotations de ServiceAccount."
  value       = module.stack.workload_role_arns
}

output "cicd_role_arn" {
  description = "Rôle assumé par le pipeline."
  value       = module.stack.cicd_role_arn
}

output "dns_records" {
  description = "Enregistrements à créer chez le bureau d'enregistrement."
  value       = module.stack.dns_records
}

output "gitops_deploy_public_key" {
  description = "Clé publique à déclarer comme deploy key en lecture seule sur le dépôt."
  value       = module.stack.gitops_deploy_public_key
}

output "image_builder" {
  description = "Projets CodeBuild construisant les images dans AWS, et bucket de source associe."
  value       = module.stack.image_builder
}

output "region" {
  description = "Region de l'environnement — les scripts la lisent ici plutot que de la deviner."
  value       = var.region
}

output "eks_console_role_arn" {
  description = "Role a endosser depuis la console AWS pour l'onglet Ressources du cluster."
  value       = module.stack.eks_console_role_arn
}

output "edge" {
  description = "Bord public : nom DNS a viser et enregistrements de validation du certificat."
  value       = module.stack.edge
}

output "cicd" {
  description = "Projet CodeBuild de l'environnement et son groupe de journaux."
  value       = module.stack.cicd
}

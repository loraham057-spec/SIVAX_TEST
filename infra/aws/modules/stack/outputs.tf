output "public_url" {
  description = "URL publique de la plateforme."
  value       = local.public_url
}

output "egress_ips" {
  description = "IP de sortie fixes — à transmettre au ministère pour l'allow-list SNIS RDC."
  value       = module.network.egress_ips
}

output "ingress_ips" {
  description = "IP publiques stables de l'ingress — cibles des enregistrements A du domaine."
  value       = module.network.ingress_ips
}

output "registry_host" {
  description = "Hôte du registre, nécessaire au pipeline de construction d'images."
  value       = module.ecr.registry_host
}

output "ecr_repository_urls" {
  description = "URL des dépôts d'images, par composant."
  value       = module.ecr.repository_urls
}

output "assets_base_url" {
  description = "URL de base des actifs statiques."
  value       = var.enable_cdn ? "${module.cloudfront[0].public_url}/assets" : module.s3_assets.direct_assets_base_url
}

output "assets_bucket" {
  description = "Bucket des actifs statiques."
  value       = module.s3_assets.bucket
}

output "postgres_fqdn" {
  description = "Nom d'hôte privé de la base."
  value       = module.rds.fqdn
}

output "secret_prefix" {
  description = "Préfixe des secrets — le SecretProviderClass y référence ses objets."
  value       = module.naming.names.secret_prefix
}

output "secret_names" {
  description = "Noms complets des secrets, par nom court."
  value       = module.secrets.secret_names
}

output "cluster_name" {
  description = "Nom du cluster EKS, pour `aws eks update-kubeconfig`."
  value       = module.runtime_eks.cluster_name
}

output "cluster_endpoint" {
  description = "Point de terminaison du serveur d'API."
  value       = module.runtime_eks.cluster_endpoint
}

output "cluster_ca_certificate" {
  description = "Autorité de certification du cluster, encodée en base64 — nécessaire à la configuration des fournisseurs Kubernetes et Helm."
  value       = module.runtime_eks.cluster_ca_certificate
}

output "oidc_issuer_url" {
  description = "Émetteur OIDC du cluster, racine des rôles IRSA."
  value       = module.runtime_eks.oidc_issuer_url
}

output "workload_role_arns" {
  description = <<-DESC
    ARN des rôles IRSA, à poser en annotation eks.amazonaws.com/role-arn des
    ServiceAccount. Ce ne sont pas des secrets ; Flux les substitue déjà depuis
    le ConfigMap cluster-vars.
  DESC
  value       = module.identity.role_arns
}

output "cicd_role_arn" {
  description = "Rôle assumé par le pipeline."
  value       = module.identity.cicd_role_arn
}

output "cdn_distribution_id" {
  description = "Distribution CloudFront. Vide quand le CDN est désactivé."
  value       = var.enable_cdn ? module.cloudfront[0].distribution_id : ""
}

output "dns_records" {
  description = <<-DESC
    Enregistrements à créer chez le bureau d'enregistrement :
      · l'origine (ingress_hostname) en A vers chaque IP d'ingress ;
      · le nom public en CNAME vers le bord, quand le CDN est actif ;
      · les enregistrements de validation du certificat, le cas échéant.
  DESC
  value = {
    ingress_a_records      = module.network.ingress_ips
    ingress_hostname       = var.ingress_hostname
    certificate_validation = var.enable_cdn ? try(module.cloudfront[0].dns_validation, null) : null
  }
}

output "gitops_deploy_public_key" {
  description = "Clé publique à déclarer comme deploy key en lecture seule sur le dépôt."
  value       = var.gitops_enabled ? module.gitops[0].deploy_public_key : ""
}

output "alerts_topic_arn" {
  description = "Sujet SNS recevant les alarmes."
  value       = module.observability.sns_topic_arn
}

output "image_builder" {
  description = "Coordonnées des projets CodeBuild : où déposer la source, et quels projets lancer."
  value = var.enable_image_builder ? {
    source_bucket   = module.image_builder[0].source_bucket
    source_key      = module.image_builder[0].source_key
    projects        = module.image_builder[0].project_names
    pod_role_arn    = module.image_builder[0].pod_role_arn
    service_account = module.image_builder[0].builder_service_account
    namespace       = module.image_builder[0].builder_namespace
  } : null
}

output "eks_console_role_arn" {
  description = <<-DESC
    Role a endosser depuis la console AWS pour voir et modifier les ressources
    Kubernetes (menu du compte, « Changer de role »).

    Le compte root ne peut pas recevoir de droits Kubernetes : EKS refuse toute
    entree d'acces pour ce principal, et la console repond « Unauthorized » sur
    l'onglet Ressources. Passer par ce role est la seule voie.
  DESC
  value       = module.runtime_eks.console_role_arn
}

output "edge" {
  description = "Le bord public : nom DNS a viser, etat du certificat, et enregistrements de validation a poser."
  value = var.enable_edge_alb ? {
    dns_name               = module.edge[0].dns_name
    zone_id                = module.edge[0].zone_id
    certificate_status     = module.edge[0].certificate_status
    certificate_validation = module.edge[0].certificate_validation_records
  } : null
}

output "cicd" {
  description = "La chaine de livraison : nom du projet a relancer a la main, et groupe de journaux."
  value = var.enable_cicd ? {
    project   = module.cicd[0].project_name
    log_group = module.cicd[0].log_group
  } : null
}

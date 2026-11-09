output "tags" {
  description = "Tags appliqués à chaque ressource de l'environnement."
  value       = local.tags
}

output "region_short" {
  description = "Code court de la région (ew3, en1…)."
  value       = local.region_short
}

output "name_prefix" {
  description = "Préfixe <projet>-<env>, utilisé par les ressources qui composent leur propre nom."
  value       = local.base
}

output "unique_suffix" {
  description = "Suffixe déterministe des noms globalement uniques."
  value       = local.unique_suffix
}

output "names" {
  description = "Noms de ressources, indexés par rôle logique."
  value = {
    # ─── Réseau ───
    vpc         = "vpc-${local.base}-${local.region_short}"
    nat_eip     = "eip-nat-${local.base}"
    ingress_eip = "eip-ingress-${local.base}"
    # Les groupes de sécurité ne peuvent PAS commencer par « sg- » : AWS
    # réserve ce préfixe à leurs identifiants et refuse la création avec
    # « invalid value for name (cannot begin with sg-) ». Le suffixe dit donc
    # ce que le préfixe dirait ailleurs.
    sg_nodes    = "${local.base}-nodes-sg"
    sg_rds      = "${local.base}-data-sg"
    sg_redis    = "${local.base}-redis-sg"
    sg_endpoint = "${local.base}-vpce-sg"

    # ─── Identité (un rôle IAM par charge de travail, pour qu'une compromission reste bornée) ───
    role_web  = "role-${var.project}-web-${var.env}"
    role_ai   = "role-${var.project}-ai-${var.env}"
    role_jobs = "role-${var.project}-jobs-${var.env}"
    role_cicd = "role-${var.project}-cicd-${var.env}"

    # ─── Données ───
    # S3 : unique mondialement, minuscules et tirets uniquement.
    assets_bucket = substr("${local.base}-assets-${local.unique_suffix}", 0, 63)
    logs_bucket   = substr("${local.base}-logs-${local.unique_suffix}", 0, 63)
    # RDS : identifiant unique par compte et par région.
    rds      = "psql-${local.base}-${local.region_short}"
    database = replace(var.project, "-", "_")
    redis    = "redis-${local.base}"

    # Préfixe des secrets AWS Secrets Manager. Les noms de secrets sont
    # identiques à ceux du Key Vault (database-url, redis-url…), préfixés par
    # le projet et l'environnement — c'est ce préfixe qui borne la politique
    # IAM de lecture des charges de travail.
    secret_prefix = "${var.project}/${var.env}"

    # ─── Registre ───
    ecr_web = "${local.base}/web"
    ecr_ai  = "${local.base}/ai"

    # ─── Exécution ───
    eks             = "eks-${local.base}-${local.region_short}"
    node_group_sys  = "system"
    node_group_user = "user"

    # ─── Bord ───
    cloudfront = "cdn-${local.base}"
    waf        = replace("waf-${local.base}", "_", "-")

    # ─── Observabilité ───
    log_group_app = "/${var.project}/${var.env}/app"
    log_group_eks = "/aws/eks/eks-${local.base}-${local.region_short}/cluster"
    sns_topic     = "alerts-${local.base}"
    budget        = "budget-${local.base}"
  }
}

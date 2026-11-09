output "source_bucket" {
  description = "Bucket où déposer l'archive de source avant de lancer un build."
  value       = aws_s3_bucket.source.bucket
}

output "source_key" {
  description = "Clé attendue par les projets pour l'archive de source."
  value       = var.source_key
}

output "project_names" {
  description = "Noms des projets CodeBuild, indexés par image."
  value       = { for k, p in aws_codebuild_project.image : k => p.name }
}

output "pod_role_arn" {
  description = "Rôle IRSA du Job de construction dans le cluster. Vide quand le cluster n'est pas passé au module."
  value       = var.enable_in_cluster_builder ? aws_iam_role.pod[0].arn : ""
}

output "builder_service_account" {
  description = "ServiceAccount que le Job de construction doit porter."
  value       = var.builder_service_account
}

output "builder_namespace" {
  description = "Namespace dans lequel le Job de construction doit tourner."
  value       = var.builder_namespace
}

output "project_name" {
  description = "Nom du projet CodeBuild — c'est lui qu'on lance a la main pour rejouer un deploiement."
  value       = var.enable_codebuild ? aws_codebuild_project.main[0].name : ""
}

output "project_arn" {
  description = "ARN du projet."
  value       = var.enable_codebuild ? aws_codebuild_project.main[0].arn : ""
}

output "log_group" {
  description = "Groupe de journaux des builds."
  value       = var.enable_codebuild ? aws_cloudwatch_log_group.build[0].name : ""
}

output "webhook_url" {
  description = "Point d'entree du webhook pose sur le depot. Vide quand le declenchement est manuel."
  value       = var.enable_codebuild && var.enable_webhook ? aws_codebuild_webhook.main[0].payload_url : ""
}


output "build_config_parameter" {
  description = "Parametre SSM que le workflow lit pour connaitre ses depots et ses valeurs de build."
  value       = var.enable_github_actions ? aws_ssm_parameter.build_config[0].name : ""
}

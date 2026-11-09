output "repository_urls" {
  description = "URL des dépôts, indexées par composant (web, ai)."
  value       = { for k, r in aws_ecr_repository.main : k => r.repository_url }
}

output "repository_arns" {
  description = "ARN des dépôts."
  value       = { for k, r in aws_ecr_repository.main : k => r.arn }
}

output "registry_host" {
  description = "Hôte du registre, préfixe des images — l'équivalent d'acr_login_server."
  value       = split("/", aws_ecr_repository.main["web"].repository_url)[0]
}

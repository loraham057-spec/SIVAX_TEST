output "role_arns" {
  description = "ARN des rôles, indexés par rôle logique. C'est la valeur de l'annotation eks.amazonaws.com/role-arn des ServiceAccount."
  value       = { for k, r in aws_iam_role.workloads : k => r.arn }
}

output "role_names" {
  description = "Noms des rôles, à passer aux attachements de politiques des modules de service."
  value       = { for k, r in aws_iam_role.workloads : k => r.name }
}

output "cicd_role_arn" {
  description = "Rôle assumé par le pipeline. Vide quand il n'est pas créé."
  value       = try(aws_iam_role.cicd[0].arn, "")
}

output "cicd_role_name" {
  description = "Nom du rôle du pipeline."
  value       = try(aws_iam_role.cicd[0].name, "")
}

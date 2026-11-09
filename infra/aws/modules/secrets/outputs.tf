output "secret_names" {
  description = "Noms complets des secrets, indexés par nom court. Ce sont ces noms que le SecretProviderClass référence en objectName."
  value       = { for k, s in aws_secretsmanager_secret.main : k => s.name }
}

output "secret_arns" {
  description = "ARN des secrets, indexés par nom court."
  value       = { for k, s in aws_secretsmanager_secret.main : k => s.arn }
}

output "secret_prefix" {
  description = "Préfixe commun des noms de secrets."
  value       = var.secret_prefix
}

output "postgres_admin_password" {
  description = "Mot de passe administrateur PostgreSQL engendré."
  value       = random_password.postgres_admin.result
  sensitive   = true
}

output "kms_key_arn" {
  description = "Clé KMS de l'environnement. Vide quand aucune n'est créée."
  value       = try(aws_kms_key.secrets[0].arn, "")
}

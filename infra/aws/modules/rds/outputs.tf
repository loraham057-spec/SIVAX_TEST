output "id" {
  description = "Identifiant de l'instance."
  value       = aws_db_instance.main.id
}

output "arn" {
  description = "ARN de l'instance — portée des alarmes CloudWatch."
  value       = aws_db_instance.main.arn
}

output "identifier" {
  description = "Identifiant lisible, dimension des métriques CloudWatch."
  value       = aws_db_instance.main.identifier
}

output "fqdn" {
  description = "Nom d'hôte privé, résoluble depuis le VPC uniquement."
  value       = aws_db_instance.main.address
}

output "database_name" {
  description = "Nom de la base applicative."
  value       = aws_db_instance.main.db_name
}

output "connection_string" {
  description = "Chaîne libpq, TLS exigé."
  value = format(
    "postgresql://%s:%s@%s:%d/%s?sslmode=require",
    var.administrator_login,
    urlencode(var.administrator_password),
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
  )
  sensitive = true
}

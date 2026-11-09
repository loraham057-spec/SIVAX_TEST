output "id" {
  description = "Identifiant du groupe de réplication."
  value       = aws_elasticache_replication_group.main.id
}

output "hostname" {
  description = "Point de terminaison principal, privé."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "connection_string" {
  description = "URL rediss:// — la valeur de REDIS_URL consommée par l'application."
  value = format(
    "rediss://:%s@%s:%d",
    random_password.auth.result,
    aws_elasticache_replication_group.main.primary_endpoint_address,
    aws_elasticache_replication_group.main.port,
  )
  sensitive = true
}

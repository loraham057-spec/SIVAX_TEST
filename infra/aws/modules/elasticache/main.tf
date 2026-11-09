/**
 * Module elasticache — l'état partagé que l'application garde aujourd'hui en
 * mémoire de processus.
 *
 * Trois choses y déménagent, et aucune ne fonctionne correctement à deux
 * répliques sans cache partagé :
 *   · les caches de métadonnées DHIS2 (24 h) et d'analytics (10 min)
 *   · le limiteur de débit de l'agent, dont la fenêtre par processus multiplie
 *     le quota effectif par le nombre de répliques
 *   · le relais d'analyse côté serveur, qui permet au client de réutiliser le
 *     résultat DHIS2 de l'agent au lieu de le rejouer
 *
 * L'application lit déjà REDIS_URL et retombe sur la mémoire locale quand il
 * est absent : provisionner ce module change le comportement sans changer le
 * code.
 *
 * Il reste FACULTATIF, pour la même raison que côté Azure : un Redis d'un seul
 * pod dans le cluster (k8s/base/redis.yaml) suffit tant que le contenu est
 * reconstructible, et il ne coûte rien. On provisionne ici quand la durabilité
 * et un SLA justifient la dépense.
 */

resource "random_password" "auth" {
  length  = 48
  special = false # ElastiCache refuse la plupart des caractères spéciaux dans un jeton
}

resource "aws_cloudwatch_log_group" "engine" {
  name              = "/aws/elasticache/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "cachesng-${var.name_prefix}"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_parameter_group" "main" {
  name   = "cachepg-${var.name_prefix}"
  family = var.parameter_group_family
  tags   = var.tags

  # Les entrées portent leur propre TTL ; évincer la moins récemment utilisée
  # sous pression est correct ici — en perdre une est un défaut de cache, pas
  # une erreur.
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = var.names.redis
  description          = "Cache partage — ${var.name_prefix}"
  tags                 = var.tags

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.replica_count + 1
  parameter_group_name = aws_elasticache_parameter_group.main.name
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = var.security_group_ids

  automatic_failover_enabled = var.replica_count > 0
  multi_az_enabled           = var.replica_count > 0

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth.result

  maintenance_window       = "sun:03:00-sun:05:00"
  snapshot_retention_limit = var.snapshot_retention_days
  apply_immediately        = var.apply_immediately

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }
}

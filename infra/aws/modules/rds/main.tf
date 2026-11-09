/**
 * Module rds — PostgreSQL managé, sans adresse publique.
 *
 * L'instance vit dans les sous-réseaux « données » du module network, qui
 * n'ont aucune route vers Internet : l'absence d'accès public est ici une
 * propriété du routage, pas une case à cocher — le pendant exact de
 * l'injection de VNet côté Azure.
 *
 * Les extensions attendues par l'application (pg_trgm, unaccent, uuid-ossp,
 * pgcrypto) ne se déclarent pas au niveau du serveur sur RDS : elles sont
 * disponibles et créées par la migration avec CREATE EXTENSION. C'est
 * `pg_trgm` avec `unaccent` qui permet à l'index de métadonnées DHIS2 local de
 * remplacer les allers-retours réseau de l'assistant, en cherchant des noms
 * d'indicateurs français sans tenir compte des accents.
 *
 * L'authentification IAM est activée : elle remplace l'administrateur Entra
 * d'Azure et permet aux jobs de se connecter avec un jeton plutôt qu'avec le
 * mot de passe, qui reste la voie de secours.
 */

locals {
  major_version    = split(".", var.engine_version)[0]
  parameter_family = "postgres${local.major_version}"
}

resource "aws_db_subnet_group" "main" {
  name       = "dbsng-${var.name_prefix}"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_db_parameter_group" "main" {
  name   = "pg-${var.name_prefix}"
  family = local.parameter_family
  tags   = var.tags

  # Journaliser les requêtes au-delà d'une seconde : le budget du chemin de
  # lecture est de 300 ms au P95, donc tout ce qui dépasse mérite un nom.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  # Vue agrégée des requêtes : c'est elle qui dit QUELLE requête est lente,
  # quand les journaux disent seulement qu'il y en a une.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier = var.names.rds
  tags       = var.tags

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  # gp3 plutôt que gp2 : mêmes IOPS de base à moindre prix, et le débit se
  # règle indépendamment de la taille.
  storage_type      = "gp3"
  allocated_storage = var.allocated_storage
  # Croissance automatique : évite l'appel de trois heures du matin pour un
  # disque qui s'est rempli de façon prévisible.
  max_allocated_storage = var.max_allocated_storage
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn == "" ? null : var.kms_key_arn

  db_name  = var.database_name
  username = var.administrator_login
  password = var.administrator_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = var.security_group_ids
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.main.name

  multi_az                            = var.multi_az
  backup_retention_period             = var.backup_retention_days
  backup_window                       = "01:00-02:00"
  maintenance_window                  = "sun:02:00-sun:04:00"
  copy_tags_to_snapshot               = true
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true
  deletion_protection                 = var.deletion_protection
  apply_immediately                   = var.apply_immediately

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null
  monitoring_interval                   = var.monitoring_interval
  monitoring_role_arn                   = var.monitoring_interval == 0 ? null : aws_iam_role.monitoring[0].arn

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # En dev, l'environnement doit se détruire sans laisser d'instantané derrière
  # lui ; en production, l'instantané final est la dernière chance après une
  # destruction non voulue.
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.names.rds}-final-${formatdate("YYYYMMDDhhmm", timestamp())}"

  lifecycle {
    ignore_changes = [
      # L'horodatage de l'instantané final change à chaque plan : sans cela,
      # RDS serait proposé en remplacement à chaque exécution.
      final_snapshot_identifier,
      # Les correctifs mineurs sont appliqués par la plateforme.
      engine_version,
    ]
  }
}

# ─── Surveillance rapprochée ───────────────────────────────

data "aws_iam_policy_document" "monitoring_assume" {
  count = var.monitoring_interval == 0 ? 0 : 1

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.monitoring_interval == 0 ? 0 : 1
  name               = "role-rds-monitoring-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.monitoring_interval == 0 ? 0 : 1
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ─── Connexion par jeton IAM ───────────────────────────────
#
# Autorise les charges nommées à ouvrir une connexion avec un jeton signé
# plutôt qu'avec le mot de passe. Le rôle de base de données `iam_app` doit
# exister côté PostgreSQL (créé par la migration) et porter rds_iam.

resource "aws_iam_role_policy" "db_connect" {
  for_each = var.iam_auth_role_names
  name     = "rds-iam-connect"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["rds-db:connect"]
      Resource = "arn:aws:rds-db:${var.region}:${var.account_id}:dbuser:${aws_db_instance.main.resource_id}/${var.iam_database_user}"
    }]
  })
}

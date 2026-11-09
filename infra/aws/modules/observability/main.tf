/**
 * Module observability — journaux, alarmes et budget.
 *
 * Les alarmes sont délibérément peu nombreuses et chacune correspond à une
 * décision que quelqu'un prendrait vraiment. Deux d'entre elles sont propres à
 * cette plateforme plutôt qu'à l'hygiène d'infrastructure :
 *
 *  · « aucun ETL réussi depuis 5 jours » — l'entrepôt est la seule chose qui
 *    sépare les utilisateurs d'un SNIS RDC lent et instable. Une
 *    synchronisation qui échoue en silence dégrade tous les tableaux de bord
 *    sans qu'aucune erreur n'apparaisse.
 *
 *  · « données plus vieilles que 48 h » — la fraîcheur est la métrique qui
 *    intéresse les décideurs ; une infrastructure au vert avec des données de
 *    trois jours est le mode de panne qui mérite d'être attrapé.
 *
 * Sur AWS cette alarme est plus simple à tenir que côté Azure : un filtre de
 * métrique sur le groupe de journaux applicatif compte les succès, et il
 * fonctionne dès le premier apply — là où la requête KQL d'Azure exigeait que
 * la table existe déjà, donc un second apply.
 */

resource "aws_cloudwatch_log_group" "app" {
  name              = var.names.log_group_app
  retention_in_days = var.retention_days
  tags              = var.tags
}

# ─── Notification ──────────────────────────────────────────
#
# Un sujet SNS, deux sortes d'abonnés : les adresses des responsables et, quand
# elle est fournie, l'URL de notification de la plateforme elle-même — pour
# qu'une alerte d'infrastructure emprunte le même canal qu'une alerte de santé.

resource "aws_sns_topic" "alerts" {
  name = var.names.sns_topic
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value

  # L'abonnement reste « en attente de confirmation » tant que le destinataire
  # n'a pas cliqué le lien reçu ; Terraform ne peut pas confirmer à sa place.
  lifecycle {
    ignore_changes = [confirmation_timeout_in_minutes]
  }
}

resource "aws_sns_topic_subscription" "webhook" {
  count     = var.alert_webhook_url == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = var.alert_webhook_url
}

# ─── Base de données ───────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "alarm-${var.env}-rds-cpu"
  alarm_description   = "CPU PostgreSQL au-dela de 80% pendant 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DBInstanceIdentifier = var.rds_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# En octets libres plutôt qu'en pourcentage : CloudWatch n'expose pas le taux
# d'occupation, et un seuil absolu se lit sans connaître la taille du disque —
# à condition de le recalculer si le stockage change, d'où la variable.
resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "alarm-${var.env}-rds-storage"
  alarm_description   = "Espace libre PostgreSQL sous le seuil — la croissance automatique n'a plus de marge."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_free_storage_threshold_bytes
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DBInstanceIdentifier = var.rds_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "alarm-${var.env}-rds-connections"
  alarm_description   = "Connexions PostgreSQL proches du plafond — une fuite de pool se manifeste ainsi."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_max_connections_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DBInstanceIdentifier = var.rds_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ─── Bord ──────────────────────────────────────────────────
#
# Les métriques CloudFront ne sont publiées que dans us-east-1 : ces alarmes
# passent donc par le fournisseur aliasé, comme le certificat et le WAF.

resource "aws_cloudwatch_metric_alarm" "cdn_5xx" {
  count    = var.enable_cdn_alarms ? 1 : 0
  provider = aws.us_east_1

  alarm_name          = "alarm-${var.env}-cdn-5xx"
  alarm_description   = "Plus de 1% des reponses du bord sont en 5xx sur 5 minutes."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DistributionId = var.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cdn_origin_latency" {
  count    = var.enable_cdn_alarms ? 1 : 0
  provider = aws.us_east_1

  alarm_name          = "alarm-${var.env}-origin-latency"
  alarm_description   = "Latence d'origine au-dela de 2 s — le budget du chemin de lecture est de 300 ms au P95."
  namespace           = "AWS/CloudFront"
  metric_name         = "OriginLatency"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 2000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DistributionId = var.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ─── Santé de l'ETL et fraîcheur des données ───────────────

resource "aws_cloudwatch_log_metric_filter" "etl_success" {
  name           = "etl-success-${var.env}"
  log_group_name = aws_cloudwatch_log_group.app.name
  # Le message est émis par le job ETL en fin de synchronisation réussie ;
  # c'est le contrat entre l'application et cette alarme.
  pattern = "\"ETL sync succeeded\""

  metric_transformation {
    name          = "EtlSuccess"
    namespace     = "${var.project}/${var.env}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "etl_missing" {
  count = var.enable_etl_freshness_alert ? 1 : 0

  alarm_name          = "alarm-${var.env}-etl-no-success"
  alarm_description   = "Aucune synchronisation ETL reussie depuis 5 jours (syncs le mercredi 03:00 et le dimanche 04:00 UTC)."
  namespace           = "${var.project}/${var.env}"
  metric_name         = "EtlSuccess"
  statistic           = "Sum"
  # Syncs run on Wednesday and Sunday: the longest normal gap between two
  # successes is 4 days (Wed → Sun). Alarm only when 5 consecutive days have
  # none, i.e. a scheduled run was missed.
  period              = 86400
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  # Absence de donnée = absence de succès : c'est exactement la condition à
  # signaler, donc « breaching » et non « notBreaching ».
  treat_missing_data = "breaching"
  tags               = var.tags

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ─── Coût ──────────────────────────────────────────────────
#
# La dépense LLM est le poste qui peut s'emballer sans que personne ne le voie,
# puisqu'elle suit l'usage et non la capacité provisionnée — et il n'existe pas
# encore de quota de jetons par utilisateur dans l'application (SEC-08).

resource "aws_budgets_budget" "monthly" {
  # Un budget sans destinataire ne sert à rien, et AWS refuse une notification
  # sans abonné.
  count = var.monthly_budget_usd == 0 || length(var.alert_emails) == 0 ? 0 : 1

  name         = var.names.budget
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Borné aux ressources de cet environnement par le tag, pour qu'un
  # dépassement désigne un coupable.
  cost_filter {
    name = "TagKeyValue"
    # Format attendu : user:<cle>$<valeur>. Composé avec format() parce que la
    # séquence littérale nécessaire heurte l'interpolation de Terraform.
    values = [format("user:env$%s", var.env)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 110
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_emails
  }
}

# ─── Export de télémétrie par les sidecars ─────────────────
#
# Le collecteur OpenTelemetry tourne DANS le pod applicatif et exporte sous le
# rôle IRSA de ce pod : c'est donc aux rôles web/ai/jobs qu'il faut donner le
# droit d'écrire des segments X-Ray et des journaux. Sans cette politique, le
# sidecar démarre, accepte l'OTLP, et échoue silencieusement à l'export — une
# panne qui ne se voit que par l'absence de traces, jamais par une erreur.
#
# X-Ray ne se borne pas à une ressource : le service n'expose pas d'ARN par
# segment. L'écriture de journaux, elle, est bornée au groupe de
# l'environnement.

resource "aws_iam_role_policy" "telemetry" {
  for_each = var.telemetry_role_names
  name     = "telemetry-write"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
        ]
        Resource = [
          aws_cloudwatch_log_group.app.arn,
          "${aws_cloudwatch_log_group.app.arn}:*",
        ]
      },
    ]
  })
}

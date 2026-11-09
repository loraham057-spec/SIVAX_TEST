output "log_group_name" {
  description = "Groupe de journaux applicatif — destination des journaux de conteneurs."
  value       = aws_cloudwatch_log_group.app.name
}

output "log_group_arn" {
  description = "ARN du groupe de journaux applicatif."
  value       = aws_cloudwatch_log_group.app.arn
}

output "sns_topic_arn" {
  description = "Sujet SNS recevant toutes les alarmes."
  value       = aws_sns_topic.alerts.arn
}

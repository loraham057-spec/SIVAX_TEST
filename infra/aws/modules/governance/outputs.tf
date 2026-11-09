output "guardduty_detector_id" {
  description = "Détecteur GuardDuty. Vide quand le service n'est pas activé."
  value       = try(aws_guardduty_detector.main[0].id, "")
}

output "access_analyzer_arn" {
  description = "Analyseur IAM Access Analyzer. Vide quand il n'est pas activé."
  value       = try(aws_accessanalyzer_analyzer.main[0].arn, "")
}

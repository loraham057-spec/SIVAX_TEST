output "distribution_id" {
  description = "Identifiant de la distribution — dimension des alarmes du bord."
  value       = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  description = "ARN de la distribution."
  value       = aws_cloudfront_distribution.main.arn
}

output "endpoint_hostname" {
  description = "Nom de domaine par défaut, en cloudfront.net."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "public_url" {
  description = "URL publique de la plateforme."
  value       = var.custom_domain == "" ? "https://${aws_cloudfront_distribution.main.domain_name}" : "https://${var.custom_domain}"
}

output "origin_verify_token" {
  description = "Valeur de l'en-tête X-Origin-Verify que l'ingress doit exiger. Secret : il tient lieu de preuve d'origine."
  value       = random_password.origin_verify.result
  sensitive   = true
}

output "dns_validation" {
  description = <<-DESC
    Enregistrements à créer chez le bureau d'enregistrement quand un domaine
    personnalisé est utilisé : le CNAME de validation du certificat, et
    l'enregistrement qui fait pointer le domaine sur la distribution.
  DESC
  value = var.custom_domain == "" ? null : {
    certificate_validation = [
      for o in aws_acm_certificate.main[0].domain_validation_options : {
        name  = o.resource_record_name
        type  = o.resource_record_type
        value = o.resource_record_value
      }
    ]
    cname_target = aws_cloudfront_distribution.main.domain_name
  }
}

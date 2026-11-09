output "dns_name" {
  description = "Nom DNS du bord — la cible des enregistrements publics."
  value       = aws_lb.main.dns_name
}

output "zone_id" {
  description = "Zone hebergee du bord, pour un enregistrement ALIAS Route 53."
  value       = aws_lb.main.zone_id
}

output "arn" {
  description = "ARN du load balancer."
  value       = aws_lb.main.arn
}

output "security_group_id" {
  description = "Groupe de securite du bord."
  value       = aws_security_group.alb.id
}

output "certificate_arn" {
  description = "Certificat ACM servi par le bord."
  value       = length(aws_acm_certificate.main) > 0 ? aws_acm_certificate.main[0].arn : ""
}

output "certificate_validation_records" {
  description = "Enregistrements CNAME a poser au registrar pour valider le certificat."
  value = length(aws_acm_certificate.main) > 0 ? [
    for o in aws_acm_certificate.main[0].domain_validation_options : {
      nom    = o.resource_record_name
      type   = o.resource_record_type
      valeur = o.resource_record_value
    }
  ] : []
}

output "certificate_status" {
  description = "Etat du certificat : ISSUED une fois les enregistrements de validation poses et pris en compte."
  value       = length(aws_acm_certificate.main) > 0 ? aws_acm_certificate.main[0].status : ""
}

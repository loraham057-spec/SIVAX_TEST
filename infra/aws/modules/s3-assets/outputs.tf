output "bucket" {
  description = "Nom du bucket."
  value       = aws_s3_bucket.main.id
}

output "arn" {
  description = "ARN du bucket."
  value       = aws_s3_bucket.main.arn
}

output "regional_domain_name" {
  description = "Nom de domaine régional — l'origine CloudFront pour les actifs."
  value       = aws_s3_bucket.main.bucket_regional_domain_name
}

output "direct_assets_base_url" {
  description = "URL directe du préfixe assets/, utilisée quand aucun CDN ne sert le bucket."
  value       = "https://${aws_s3_bucket.main.bucket_regional_domain_name}/assets"
}

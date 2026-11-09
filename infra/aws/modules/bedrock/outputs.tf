output "endpoint" {
  description = "Point de terminaison régional du service — la valeur de BEDROCK_ENDPOINT quand l'application l'attend."
  value       = "https://bedrock-runtime.${data.aws_region.current.name}.amazonaws.com"
}

output "model_ids" {
  description = "Identifiants de modèles autorisés."
  value       = var.model_ids
}

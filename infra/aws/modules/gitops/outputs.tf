output "deploy_public_key" {
  description = "Moitié publique de la clé de déploiement Flux — à déclarer dans le dépôt (Settings → Deploy keys), en lecture seule. Ce n'est pas un secret."
  value       = try(tls_private_key.deploy[0].public_key_openssh, "")
}

output "namespace" {
  description = "Namespace hébergeant Flux."
  value       = kubernetes_namespace.flux.metadata[0].name
}

output "state_bucket" {
  description = "Bucket d'état — la valeur de `bucket` dans backend.hcl."
  value       = aws_s3_bucket.tfstate.id
}

output "lock_table" {
  description = "Table de verrous — la valeur de `dynamodb_table` dans backend.hcl."
  value       = aws_dynamodb_table.lock.name
}

output "region" {
  description = "Région du backend."
  value       = var.region
}

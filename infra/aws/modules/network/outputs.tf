output "vpc_id" {
  description = "Identifiant du VPC."
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR du VPC."
  value       = aws_vpc.main.cidr_block
}

output "availability_zones" {
  description = "Zones de disponibilité utilisées."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "Sous-réseaux publics — NLB d'ingress et NAT."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Sous-réseaux privés — nœuds EKS et pods."
  value       = aws_subnet.private[*].id
}

output "private_subnet_cidrs" {
  description = "CIDR des sous-réseaux privés, pour les règles de groupe de sécurité des services de données."
  value       = local.private_cidrs
}

output "database_subnet_ids" {
  description = "Sous-réseaux de données, sans route vers Internet."
  value       = aws_subnet.database[*].id
}

output "data_security_group_id" {
  description = "Groupe de sécurité porté par RDS et ElastiCache."
  value       = aws_security_group.data.id
}

output "egress_ips" {
  description = "IP de sortie fixes — ce sont ces adresses à transmettre au ministère pour l'allow-list SNIS RDC."
  value       = aws_eip.nat[*].public_ip
}

output "egress_ip" {
  description = "Première IP de sortie, pour les usages qui n'en attendent qu'une."
  value       = aws_eip.nat[0].public_ip
}

output "ingress_ips" {
  description = "IP publiques stables de l'ingress — les enregistrements A du domaine pointent ici."
  value       = aws_eip.ingress[*].public_ip
}

output "ingress_eip_allocation_ids" {
  description = "Allocations à passer au NLB par l'annotation service.beta.kubernetes.io/aws-load-balancer-eip-allocations."
  value       = aws_eip.ingress[*].id
}

output "ingress_ip" {
  description = "Première IP d'ingress — origine par défaut du CDN et valeur affichée comme point d'entrée."
  value       = try(aws_eip.ingress[0].public_ip, "")
}

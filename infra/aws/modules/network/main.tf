/**
 * Module network — VPC, sous-réseaux, NAT et points de terminaison privés.
 *
 * Trois propriétés comptent au-delà du « ça marche », et ce sont exactement
 * celles que portait le module Azure équivalent :
 *
 *  · Adresse de sortie fixe. Tout le trafic sortant passe par une NAT Gateway
 *    dont l'IP élastique est allouée ici. C'est le préalable pour demander au
 *    ministère une entrée d'allow-list SNIS RDC : sans elle l'adresse de
 *    sortie change au gré du remplacement des nœuds.
 *
 *  · Aucun plan de données public. RDS et ElastiCache vivent dans des
 *    sous-réseaux sans route par défaut vers Internet ; S3, ECR, Secrets
 *    Manager, CloudWatch et STS sont joints par des points de terminaison de
 *    VPC, donc le trafic ne sort jamais du réseau AWS.
 *
 *  · Adresses d'entrée pré-allouées. Le NLB de l'ingress adopte les EIP créées
 *    ici (annotation aws-load-balancer-eip-allocations). C'est ce qui permet
 *    de câbler l'origine CloudFront et l'enregistrement DNS dès le premier
 *    apply, sans deuxième passe pour relire une adresse — le pendant exact du
 *    `azurerm_public_ip.ingress` côté Azure.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Deux zones en dev, trois quand la redondance de zone est demandée. Chaque
  # zone coûte une NAT Gateway si zone_redundant est vrai — c'est le principal
  # levier de coût de ce module.
  az_count = var.zone_redundant ? 3 : 2
  azs      = slice(data.aws_availability_zones.available.names, 0, local.az_count)

  # Découpage déterministe du CIDR, comme côté Azure :
  #   public  /20 — NLB, NAT
  #   privé   /20 — nœuds EKS et pods
  #   données /24 — RDS, ElastiCache
  public_cidrs  = [for i in range(local.az_count) : cidrsubnet(var.address_space, 4, i)]
  private_cidrs = [for i in range(local.az_count) : cidrsubnet(var.address_space, 4, 4 + i)]
  db_cidrs      = [for i in range(local.az_count) : cidrsubnet(var.address_space, 8, 128 + i)]

  nat_count = var.zone_redundant ? local.az_count : 1
}

resource "aws_vpc" "main" {
  cidr_block           = var.address_space
  enable_dns_support   = true
  enable_dns_hostnames = true # requis par les points de terminaison d'interface

  tags = merge(var.tags, { Name = var.names.vpc })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "igw-${var.name_prefix}" })
}

# ─── Sous-réseaux ──────────────────────────────────────────

# Publics : NLB de l'ingress et NAT Gateway, rien d'autre. Les tags
# kubernetes.io/role/elb sont lus par l'AWS Load Balancer Controller pour
# choisir où poser un load balancer public — sans eux, un Service de type
# LoadBalancer reste <pending> sans message explicite.
resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name                                        = "snet-public-${var.name_prefix}-${count.index}"
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  })
}

# Privés : nœuds EKS et pods. Sortie par la NAT, jamais d'entrée directe.
resource "aws_subnet" "private" {
  count             = local.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = merge(var.tags, {
    Name                                        = "snet-private-${var.name_prefix}-${count.index}"
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  })
}

# Données : aucune route vers Internet, pas même par la NAT. Un service placé
# ici est structurellement injoignable depuis l'extérieur, ce qui remplace la
# délégation de sous-réseau côté Azure.
resource "aws_subnet" "database" {
  count             = local.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.db_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = merge(var.tags, { Name = "snet-db-${var.name_prefix}-${count.index}" })
}

# ─── Sortie : une adresse publique stable ──────────────────

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.names.nat_eip}-${count.index}" })
}

resource "aws_nat_gateway" "main" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(var.tags, { Name = "natgw-${var.name_prefix}-${count.index}" })

  depends_on = [aws_internet_gateway.main]
}

# ─── Entrée : EIP pré-allouées pour le NLB de l'ingress ────
#
# Une par sous-réseau public, parce qu'un NLB exige une allocation par zone où
# il est présent. Ce sont ces adresses qu'on publie au DNS et qu'on donne comme
# origine à CloudFront.
resource "aws_eip" "ingress" {
  count  = var.create_ingress_eip ? local.az_count : 0
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.names.ingress_eip}-${count.index}" })
}

# ─── Routage ───────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "rt-public-${var.name_prefix}" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Une table par zone quand il y a une NAT par zone : sinon une panne de zone
# emporte la sortie des autres.
resource "aws_route_table" "private" {
  count  = local.az_count
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "rt-private-${var.name_prefix}-${count.index}" })
}

resource "aws_route" "private_nat" {
  count                  = local.az_count
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.zone_redundant ? count.index : 0].id
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Table sans route par défaut : c'est l'absence de route qui isole les données.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "rt-db-${var.name_prefix}" })
}

resource "aws_route_table_association" "database" {
  count          = local.az_count
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

# ─── Groupes de sécurité ───────────────────────────────────

# Les services de données n'acceptent que le trafic né dans les sous-réseaux
# privés : les pods sortent par l'ENI de leur nœud, donc par ces CIDR.
resource "aws_security_group" "data" {
  name        = var.names.sg_rds
  description = "Acces aux services de donnees depuis les sous-reseaux prives uniquement."
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = var.names.sg_rds })
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  count             = local.az_count
  security_group_id = aws_security_group.data.id
  cidr_ipv4         = local.private_cidrs[count.index]
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
  description       = "PostgreSQL depuis les noeuds"
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  count             = local.az_count
  security_group_id = aws_security_group.data.id
  cidr_ipv4         = local.private_cidrs[count.index]
  from_port         = 6379
  to_port           = 6379
  ip_protocol       = "tcp"
  description       = "Redis depuis les noeuds"
}

# ─── Points de terminaison de VPC ──────────────────────────
#
# S3 en passerelle : gratuit, et il évite de faire transiter les artefacts et
# les couches d'images par la NAT (qui, elle, se facture au gigaoctet).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.database.id])
  tags              = merge(var.tags, { Name = "vpce-s3-${var.name_prefix}" })
}

# Interfaces : chacune coûte de l'ordre de 7 USD par mois et par zone, d'où
# l'interrupteur. Les activer ferme la dernière voie par laquelle un appel à
# Secrets Manager ou à ECR sortirait sur Internet public.
locals {
  interface_endpoints = var.enable_interface_endpoints ? toset([
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "logs",
    "sts",
  ]) : toset([])
}

resource "aws_security_group" "endpoints" {
  count = var.enable_interface_endpoints ? 1 : 0
  name  = var.names.sg_endpoint
  # ASCII SANS APOSTROPHE NI ACCENT, et ce n'est pas du purisme : AWS refuse
  # toute description de groupe de securite hors du jeu
  # a-zA-Z0-9. _-:/()#,@[]+=&;{}!$* — une apostrophe ou un accent fait echouer
  # la creation sur « Invalid security group description », et avec elle tout
  # l'apply. Le defaut ne se voit pas en dev, ou les points de terminaison
  # d'interface sont eteints.
  description = "HTTPS depuis le VPC vers les points de terminaison interface"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = var.names.sg_endpoint })
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_https" {
  count             = var.enable_interface_endpoints ? 1 : 0
  security_group_id = aws_security_group.endpoints[0].id
  cidr_ipv4         = var.address_space
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS depuis le VPC"
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.interface_endpoints
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true
  tags                = merge(var.tags, { Name = "vpce-${each.value}-${var.name_prefix}" })
}

# ─── Journalisation des flux ───────────────────────────────
#
# Le pendant des journaux de diagnostic du NSG Azure : seuls les rejets sont
# journalisés, c'est-à-dire la seule moitié du trafic qui explique pourquoi une
# connexion attendue n'arrive pas.
resource "aws_flow_log" "main" {
  count                = var.enable_flow_logs ? 1 : 0
  vpc_id               = aws_vpc.main.id
  traffic_type         = "REJECT"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow[0].arn
  iam_role_arn         = aws_iam_role.flow[0].arn
  tags                 = var.tags
}

resource "aws_cloudwatch_log_group" "flow" {
  count             = var.enable_flow_logs ? 1 : 0
  name              = "/aws/vpc/${var.names.vpc}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "flow_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow" {
  count              = var.enable_flow_logs ? 1 : 0
  name               = "role-flowlogs-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.flow_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "flow" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "write-flow-logs"
  role  = aws_iam_role.flow[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = "${aws_cloudwatch_log_group.flow[0].arn}:*"
    }]
  })
}

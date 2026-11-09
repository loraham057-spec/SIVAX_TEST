/**
 * Module edge-alb — le bord public de la plateforme.
 *
 * ─── Pourquoi un ALB, et pas ce qui etait prevu ───
 *
 * La conception d'origine posait un NLB devant l'ingress, avec des IP
 * elastiques pre-allouees, et CloudFront devant lui. Ce compte AWS refuse les
 * deux : « OperationNotPermitted: This AWS account currently does not support
 * creating load balancers » sur elbv2 en mode network, et « Your account must
 * be verified before you can add new CloudFront resources » sur CloudFront. Les
 * trois APIs ont ete appelees directement pour le verifier : seuls l'ALB et le
 * Classic passent.
 *
 * L'ALB n'est pas un pis-aller pour autant. Il apporte ce que le montage
 * precedent obtenait par des detours :
 *
 *  · TLS par ACM, renouvele par AWS. Plus de dependance a Let's Encrypt pour
 *    le certificat public : ni quota d'emission, ni defi HTTP-01, ni
 *    auto-verification a faire aboutir depuis l'interieur du cluster.
 *  · Routage par nom d'hote, natif. Un seul bord peut servir plusieurs noms.
 *  · Un nom DNS stable, qui survit au remplacement de la ressource — ce que
 *    l'adresse IP, elle, ne fait pas.
 *
 * ─── Comment il joint le cluster ───
 *
 * Le Service de l'ingress est un NodePort a ports FIXES (Terraform les connait
 * donc au plan), et le groupe cible s'alimente en attachant les groupes
 * d'auto-scaling des noeuds : un noeud qui arrive ou qui est remplace est
 * enregistre et retire tout seul.
 *
 * Le TLS s'arrete ici. nginx, derriere, ne parle que HTTP — d'ou
 * `use-forwarded-headers` cote controleur, sans quoi il verrait des requetes
 * en clair, poserait une redirection vers HTTPS, et l'ALB la lui renverrait :
 * une boucle de redirection qui ne se voit qu'a l'usage.
 */

locals {
  # Le nom porte l'environnement ; 32 caracteres au maximum cote AWS.
  name = substr("${var.name_prefix}-edge", 0, 32)

  # Le nom public et, quand il differe, le nom de secours servi par le meme
  # bord. Les doublons sont retires : ACM refuse un certificat qui liste deux
  # fois le meme nom.
  domains = distinct(compact(concat([var.domain_name], var.extra_domain_names)))
}

# ─── Groupe de securite ────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = substr("${var.name_prefix}-edge-sg", 0, 255)
  description = "Bord public HTTP et HTTPS"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-edge-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS depuis Internet"
}

# Le port 80 n'est ouvert que pour rediriger vers 443 : aucune requete n'est
# servie en clair.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  description       = "HTTP depuis Internet, redirige vers HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "nodes" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "-1"
  description       = "Vers les noeuds du cluster"
}

# Reciproque cote noeuds : eux seuls acceptent le trafic de CE bord, sur les
# deux ports fixes du Service. C'est ce qui remplace la restriction par liste
# de prefixes CloudFront — plus etroit, et sans dependre d'une liste tierce.
resource "aws_vpc_security_group_ingress_rule" "node_http" {
  security_group_id            = var.node_security_group_id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.ingress_http_node_port
  to_port                      = var.ingress_http_node_port
  ip_protocol                  = "tcp"
  description                  = "Ingress HTTP depuis le bord"
}

resource "aws_vpc_security_group_ingress_rule" "node_https" {
  security_group_id            = var.node_security_group_id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.ingress_https_node_port
  to_port                      = var.ingress_https_node_port
  ip_protocol                  = "tcp"
  description                  = "Ingress HTTPS depuis le bord"
}

# ─── Certificat ────────────────────────────────────────────
#
# Dans LA REGION de l'ALB, contrairement a CloudFront qui exige us-east-1.
# Validation par DNS : elle se renouvelle toute seule tant que les
# enregistrements restent en place, la validation par courriel non.

resource "aws_acm_certificate" "main" {
  count = length(local.domains) > 0 ? 1 : 0

  domain_name               = local.domains[0]
  subject_alternative_names = slice(local.domains, 1, length(local.domains))
  validation_method         = "DNS"
  tags                      = merge(var.tags, { Name = local.name })

  lifecycle {
    create_before_destroy = true
  }
}

# Bloquant, et c'est voulu quand on le demande : un ALB dont le certificat
# n'est pas encore valide sert une erreur TLS a tout le monde. `false` le temps
# de poser les enregistrements de validation, `true` ensuite.
resource "aws_acm_certificate_validation" "main" {
  count = length(local.domains) > 0 && var.wait_for_certificate ? 1 : 0

  certificate_arn = aws_acm_certificate.main[0].arn

  timeouts {
    create = "45m"
  }
}

# ─── Load balancer ─────────────────────────────────────────

resource "aws_lb" "main" {
  name               = local.name
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]

  # Une requete longue — un flux de reponse du modele — ne doit pas etre
  # coupee par le bord avant que l'application ait fini.
  idle_timeout = var.idle_timeout

  drop_invalid_header_fields = true
  enable_http2               = true

  tags = merge(var.tags, { Name = local.name })
}

resource "aws_lb_target_group" "ingress" {
  name        = substr("${var.name_prefix}-ingress", 0, 32)
  port        = var.ingress_http_node_port
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-ingress" })

  # /healthz est servi par le controleur d'ingress lui-meme, pas par
  # l'application : le bord doit distinguer « le point d'entree est debout » de
  # « l'application repond », sinon un deploiement applicatif fait sortir tous
  # les noeuds du service.
  health_check {
    enabled             = true
    path                = "/healthz"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Le temps qu'un noeud qui s'en va finisse ses requetes en cours.
  deregistration_delay = 30

  lifecycle {
    create_before_destroy = true
  }
}

# L'ASG plutot que des instances nommees : les noeuds arrivent et sont
# remplaces sans que personne ait a reenregistrer quoi que ce soit.
resource "aws_autoscaling_attachment" "nodes" {
  # Indexe par pool — « system », « user » — et non par nom de groupe : les noms
  # ne sont connus qu'apres l'apply, et un for_each construit dessus fait
  # echouer le plan des qu'un groupe de noeuds est remplace.
  for_each = var.node_autoscaling_groups

  autoscaling_group_name = each.value
  lb_target_group_arn    = aws_lb_target_group.ingress.arn
}

# ─── Ecouteurs ─────────────────────────────────────────────

# L'ecouteur HTTPS n'existe QU'UNE FOIS le certificat valide. Ce n'est pas une
# precaution : l'ALB refuse net un certificat encore en attente de validation,
# avec « UnsupportedCertificate: The certificate must have a fully-qualified
# domain name, a supported signature, and a supported key size » — un message
# qui pointe vers le certificat plutot que vers son etat, et qui envoie donc
# chercher au mauvais endroit.
#
# D'ou la bascule en deux temps, portee par wait_for_certificate :
#   1. false — le bord existe et sert en clair sur son propre nom DNS, le
#      certificat est demande, on pose les enregistrements de validation ;
#   2. true  — l'apply attend la validation, puis pose l'ecouteur HTTPS et la
#      redirection depuis le port 80.
resource "aws_lb_listener" "https" {
  count = length(local.domains) > 0 && var.wait_for_certificate ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.main[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress.arn
  }

  # Sans cette dependance, l'ecouteur peut etre cree avec un certificat encore
  # « en attente de validation » : il sert alors une erreur TLS.
  depends_on = [aws_acm_certificate_validation.main]
}

# Sans nom de domaine, le bord sert quand meme — en clair, sur son propre nom
# DNS. C'est l'etat d'un environnement avant que son DNS soit pose, et il vaut
# mieux qu'il reponde que pas du tout.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Rediriger vers un port 443 qui n'ecoute pas encore rendrait le bord muet.
  # La redirection n'apparait donc qu'avec l'ecouteur HTTPS ; avant lui, le
  # port 80 sert directement.
  dynamic "default_action" {
    for_each = length(aws_lb_listener.https) > 0 ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = length(aws_lb_listener.https) > 0 ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.ingress.arn
    }
  }
}

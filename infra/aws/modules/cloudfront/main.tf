/**
 * Module cloudfront — le bord : CDN, WAF, TLS et cache des actifs.
 *
 * Pendant du module frontdoor. Deux origines :
 *
 *  · l'application, jointe par le NLB d'ingress (origine personnalisée) ;
 *  · les actifs statiques, servis directement depuis S3 par un contrôle
 *    d'accès d'origine (OAC), donc sans rendre le bucket public.
 *
 * L'en-tête `X-Origin-Verify` remplace `X-Azure-FDID` : CloudFront l'ajoute à
 * chaque requête vers l'origine, et l'ingress rejette ce qui ne le porte pas.
 * Combiné au groupe de sécurité restreint à la liste de préfixes CloudFront
 * (module runtime-eks), l'ingress devient injoignable en direct — la même
 * défense à deux niveaux que côté Azure, où le NSG filtrait
 * AzureFrontDoor.Backend et nginx vérifiait le FDID.
 *
 * ⚠️ Certificat et WAF vivent obligatoirement en us-east-1 pour une
 * distribution CloudFront, quelle que soit la région de la plateforme. C'est la
 * raison du fournisseur aliasé, pas une préférence.
 */

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

# ─── Certificat ────────────────────────────────────────────

resource "aws_acm_certificate" "main" {
  count    = var.custom_domain == "" ? 0 : 1
  provider = aws.us_east_1

  domain_name       = var.custom_domain
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# La validation attend que l'enregistrement CNAME existe chez le bureau
# d'enregistrement. Sans zone Route 53 gérée ici, elle est déclarée comme une
# attente explicite : l'apply reste bloqué tant que l'enregistrement n'est pas
# posé, plutôt que de créer une distribution sans TLS valide.
resource "aws_acm_certificate_validation" "main" {
  count    = var.custom_domain != "" && var.wait_for_certificate ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.main[0].arn

  timeouts {
    create = "60m"
  }
}

# ─── WAF ───────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "main" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1

  name        = var.names.waf
  description = "Regles managees AWS devant la plateforme."
  scope       = "CLOUDFRONT"
  tags        = var.tags

  default_action {
    allow {}
  }

  # Le jeu de règles de base : injections, chemins traversants, agents connus.
  # `count_override` en mode détection permet de mesurer avant de bloquer —
  # c'est le pendant de waf_mode = Detection côté Azure, et le seul moyen de ne
  # pas bloquer les développeurs pendant le réglage.
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      dynamic "none" {
        for_each = var.waf_mode == "Prevention" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_mode == "Prevention" ? [] : [1]
        content {}
      }
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common-rules"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      dynamic "none" {
        for_each = var.waf_mode == "Prevention" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_mode == "Prevention" ? [] : [1]
        content {}
      }
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Limitation de débit par IP. L'agent n'a pas encore de quota de jetons par
  # utilisateur (SEC-08) ; ce plafond au bord est la seule barrière contre une
  # boucle qui interroge le LLM en continu.
  rule {
    name     = "RateLimit"
    priority = 10

    action {
      dynamic "block" {
        for_each = var.waf_mode == "Prevention" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_mode == "Prevention" ? [] : [1]
        content {}
      }
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = replace(var.names.waf, "-", "")
    sampled_requests_enabled   = true
  }
}

# ─── Accès d'origine aux actifs ────────────────────────────

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "oac-${var.name_prefix}"
  description                       = "Acces S3 des actifs statiques"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── Distribution ──────────────────────────────────────────

locals {
  app_origin_id    = "app"
  assets_origin_id = "assets"
}

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = var.names.cloudfront
  price_class     = var.price_class
  aliases         = var.custom_domain == "" ? [] : [var.custom_domain]
  web_acl_id      = var.enable_waf ? aws_wafv2_web_acl.main[0].arn : null
  tags            = var.tags

  origin {
    origin_id   = local.app_origin_id
    domain_name = var.app_origin_host

    custom_origin_config {
      http_port  = 80
      https_port = 443
      # L'origine est jointe en HTTP quand l'ingress ne porte pas encore de
      # certificat pour ce nom : le TLS public est terminé par CloudFront. En
      # HTTPS dès que cert-manager a émis le certificat de l'ingress.
      origin_protocol_policy   = var.origin_protocol_policy
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    # La preuve que la requête vient de CETTE distribution, et pas d'un autre
    # client qui aurait trouvé l'adresse de l'ingress.
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  origin {
    origin_id                = local.assets_origin_id
    domain_name              = var.assets_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
    origin_path              = ""
  }

  # Chemin par défaut : l'application. Rien n'est mis en cache par défaut —
  # les pages portent des données qui changent, et un cache au bord y ferait
  # apparaître les données d'un utilisateur chez un autre.
  default_cache_behavior {
    target_origin_id       = local.app_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Politiques managées : CachingDisabled et AllViewer (transmet en-têtes,
    # cookies et chaîne de requête à l'origine).
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  # Actifs statiques : immuables, mis en cache longtemps. C'est ce qui décharge
  # les répliques d'octets qui ne changent jamais.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = local.assets_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # CachingOptimized.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # Ressources statiques de Next.js : même raisonnement, servies par
  # l'application mais avec des noms contenant un condensat.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = local.app_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.custom_domain == ""
    acm_certificate_arn            = var.custom_domain == "" ? null : aws_acm_certificate.main[0].arn
    ssl_support_method             = var.custom_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.custom_domain == "" ? null : "TLSv1.2_2021"
  }

  depends_on = [aws_acm_certificate_validation.main]
}

# ─── Politique du bucket d'actifs ──────────────────────────
#
# Écrite ici et non dans le module s3-assets : elle référence la distribution,
# qui référence elle-même le bucket. La poser du côté qui connaît les deux
# évite le cycle.

data "aws_iam_policy_document" "assets" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${var.assets_bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = var.assets_bucket
  policy = data.aws_iam_policy_document.assets.json
}

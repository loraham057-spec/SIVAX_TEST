/**
 * Module s3-assets — actifs statiques, artefacts ML et exports.
 *
 * Le préfixe `assets/` existe pour sortir le GeoJSON des provinces et les
 * images du conteneur applicatif : CloudFront les sert depuis ici, donc les
 * répliques ne dépensent ni bande passante ni CPU pour des octets qui ne
 * changent jamais. La règle de cycle de vie est ce qui rend sûres les longues
 * durées de cache sur les autres préfixes.
 *
 * Le bucket est privé par défaut et le chiffrement est activé côté serveur.
 * Deux exceptions assumées, toutes deux pilotées par une variable :
 *
 *  · `assets_public_read` ouvre le seul préfixe `assets/` en lecture anonyme.
 *    C'est ce qu'il faut quand aucun CDN n'est provisionné, faute de quoi
 *    l'application référence des URL que personne ne peut lire. Avec CloudFront
 *    devant, il reste faux et l'accès passe par l'OAC (module cloudfront).
 *
 *  · `force_destroy` autorise la destruction d'un bucket non vide — vrai en
 *    dev, où l'environnement doit se reconstruire sans geste manuel.
 */

resource "aws_s3_bucket" "main" {
  bucket        = var.names.assets_bucket
  force_destroy = var.force_destroy
  tags          = var.tags
}

resource "aws_s3_bucket_ownership_controls" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    object_ownership = "BucketOwnerEnforced" # les ACL n'ont plus cours
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls  = true
  ignore_public_acls = true
  # Une politique publique ne peut exister que si le blocage la laisse passer :
  # c'est l'interrupteur unique du mode « assets lisibles sans CDN ».
  block_public_policy     = !var.assets_public_read
  restrict_public_buckets = !var.assets_public_read
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn == "" ? "AES256" : "aws:kms"
      kms_master_key_id = var.kms_key_arn == "" ? null : var.kms_key_arn
    }
    bucket_key_enabled = var.kms_key_arn != ""
  }
}

# ─── Cycle de vie ──────────────────────────────────────────
#
# Les exports et les artefacts ML s'accumulent sans fin autrement. `assets/`
# est exclu : petit, immuable, et servi sur le chemin chaud.

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "tier-and-expire-artifacts"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = var.artifact_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "tier-and-expire-ml-artifacts"
    status = "Enabled"

    filter {
      prefix = "ml-artifacts/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = var.artifact_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# ─── Lecture anonyme du préfixe assets/ ────────────────────

data "aws_iam_policy_document" "public_assets" {
  count = var.assets_public_read ? 1 : 0

  statement {
    sid    = "PublicReadAssets"
    effect = "Allow"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.main.arn}/assets/*"]
  }
}

resource "aws_s3_bucket_policy" "public_assets" {
  count  = var.assets_public_read ? 1 : 0
  bucket = aws_s3_bucket.main.id
  policy = data.aws_iam_policy_document.public_assets[0].json

  # La politique est refusée tant que le blocage public est en place.
  depends_on = [aws_s3_bucket_public_access_block.main]
}

# ─── Accès des charges de travail ──────────────────────────

resource "aws_iam_role_policy" "contributors" {
  for_each = var.contributor_role_names
  name     = "s3-assets-write"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.main.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
        ]
        Resource = "${aws_s3_bucket.main.arn}/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "readers" {
  for_each = var.reader_role_names
  name     = "s3-assets-read"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.main.arn}/*"
      },
    ]
  })
}

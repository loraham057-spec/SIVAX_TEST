/**
 * Bootstrap — le backend d'état Terraform, créé par Terraform lui-même.
 *
 * Il ne crée que le couple œuf-poule : le bucket S3 et la table de verrous qui
 * portent l'état de tous les autres environnements.
 *
 * Cette configuration garde son PROPRE état dans un fichier local, à dessein :
 * elle ne peut pas stocker son état dans le bucket qu'elle crée. C'est le seul
 * état non distant du dépôt ; il est ignoré par git, et le perdre se rattrape
 * en important les deux ressources.
 *
 *   cd infra/aws/bootstrap
 *   terraform init && terraform apply
 *
 * Le rôle de déploiement n'est PAS créé ici : il dépend du fournisseur OIDC du
 * compte et se crée avec l'environnement (module identity), ou existe déjà.
 */

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
  # État local, à dessein : cette configuration crée le backend distant.
}

provider "aws" {
  region = var.region
}

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name

  tags = {
    project    = var.project
    purpose    = "tfstate"
    managed-by = "terraform-bootstrap"
  }
}

# Le versionnement est ce qui rend un état corrompu récupérable : chaque apply
# écrase l'objet, et sans versions il n'existe aucune version antérieure.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# L'état contient des valeurs sensibles en clair : rien de ce bucket ne doit
# pouvoir devenir public, quelle que soit la politique qu'on lui pose ensuite.
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Refuse tout accès non chiffré en transit — l'état transite en clair sinon.
data "aws_iam_policy_document" "tfstate" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = data.aws_iam_policy_document.tfstate.json
}

# Purge les versions anciennes : sans elle, chaque apply laisse une version de
# plus et le bucket grossit indéfiniment.
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days           = 90
      newer_noncurrent_versions = 10
    }
  }
}

# Verrou d'état. À partir de Terraform 1.10, `use_lockfile = true` dans le
# backend remplace cette table par un objet .tflock ; ce dépôt est épinglé à
# 1.9.8 (infra/.terraform-version), donc la table reste nécessaire.
resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST" # quelques écritures par jour : le mode provisionné ne se justifie pas
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    project    = var.project
    purpose    = "tfstate-lock"
    managed-by = "terraform-bootstrap"
  }
}

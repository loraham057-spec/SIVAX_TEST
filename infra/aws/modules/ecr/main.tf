/**
 * Module ecr — registre de conteneurs.
 *
 * Un dépôt par image (web, ai) plutôt qu'un dépôt fourre-tout : la politique
 * de cycle de vie, l'analyse de vulnérabilités et les droits de poussée se
 * raisonnent alors par composant.
 *
 * Aucun mot de passe de registre n'existe : les nœuds tirent avec le rôle IAM
 * du groupe de nœuds, et le pipeline pousse avec le rôle qu'il assume par
 * fédération. C'est le pendant d'`admin_enabled = false` côté ACR.
 *
 * `scan_on_push` est l'ajout qu'ACR Basic ne permettait pas : chaque image
 * poussée est analysée sans surcoût.
 */

locals {
  repositories = {
    web = var.names.ecr_web
    ai  = var.names.ecr_ai
  }
}

resource "aws_ecr_repository" "main" {
  for_each = local.repositories

  name                 = each.value
  image_tag_mutability = var.image_tag_mutability
  force_delete         = var.force_delete
  tags                 = merge(var.tags, { component = each.key })

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = var.kms_key_arn == "" ? "AES256" : "KMS"
    kms_key         = var.kms_key_arn == "" ? null : var.kms_key_arn
  }
}

# Sans cette politique, chaque build laisse derrière lui le manifeste qu'il
# vient de remplacer, et le dépôt grossit indéfiniment.
resource "aws_ecr_lifecycle_policy" "main" {
  for_each   = aws_ecr_repository.main
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Purger les manifestes sans tag apres 30 jours"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 30
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Conserver les ${var.keep_last_images} dernieres images taguees sha-"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = var.keep_last_images
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ─── Droits de tirage ──────────────────────────────────────
#
# Le rôle des nœuds porte déjà AmazonEC2ContainerRegistryReadOnly. La politique
# de dépôt ci-dessous n'existe que pour les principaux qui ne passent pas par
# lui — un compte tiers, un runner externe.

data "aws_iam_policy_document" "pull" {
  count = length(var.pull_principal_arns) == 0 ? 0 : 1

  statement {
    sid    = "AllowPull"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = var.pull_principal_arns
    }

    actions = [
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:BatchCheckLayerAvailability",
    ]
  }
}

resource "aws_ecr_repository_policy" "pull" {
  for_each   = length(var.pull_principal_arns) == 0 ? {} : aws_ecr_repository.main
  repository = each.value.name
  policy     = data.aws_iam_policy_document.pull[0].json
}

# ─── Droits de poussée ─────────────────────────────────────
#
# Attachés au rôle du pipeline. `GetAuthorizationToken` ne se borne pas à une
# ressource — c'est une propriété du service, pas un oubli.

resource "aws_iam_role_policy" "push" {
  for_each = toset(var.push_role_names)
  name     = "ecr-push-${var.name_prefix}"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeImages",
          "ecr:ListImages",
        ]
        Resource = [for r in aws_ecr_repository.main : r.arn]
      },
    ]
  })
}

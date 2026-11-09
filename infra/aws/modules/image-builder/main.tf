/**
 * Module image-builder — construction des images DANS AWS.
 *
 * Pourquoi ce module existe. Le chemin normal de construction est le pipeline
 * (.azuredevops/pipelines/app-build.yml) : c'est lui qui tient les barrières —
 * lint, typecheck, budget d'actifs, tests backend, scan Trivy, signature. Mais
 * il suppose une organisation Azure DevOps configurée, des variable groups
 * remplis et un push sur une branche déployable. Rien de tout cela n'est vrai
 * la première fois qu'un environnement est monté, et il faut pourtant une image
 * dans ECR avant qu'un pod puisse démarrer.
 *
 * L'alternative — construire sur le poste de quelqu'un — n'en est pas une : la
 * machine devient une dépendance du déploiement, l'image dépend de ce qui est
 * installé dessus, et personne ne peut reproduire ce qui a été poussé.
 *
 * Donc : un projet CodeBuild par image, qui lit sa source dans un objet S3
 * versionné et pousse dans ECR. Deux propriétés en découlent, et ce sont
 * exactement celles qui manquaient au build local :
 *
 *  · Aucune identification tierce. La source vient de S3, pas de GitHub — pas
 *    de jeton de dépôt à créer, à stocker ni à faire tourner pour amorcer un
 *    environnement.
 *  · Le rôle IAM du projet est ce qui autorise le push, borné aux deux dépôts
 *    de cet environnement. Il n'existe aucune clé de registre.
 *
 * Ce module ne remplace pas le pipeline : il n'exécute ni les tests ni le scan.
 * Il sert l'amorçage et le dépannage — « pousser une image maintenant, sans
 * poste de travail » — et le pipeline reprend la main dès qu'il est branché.
 */

locals {
  # Un seul bucket pour les deux projets : la source est la même archive, et
  # c'est le buildspec qui diffère.
  source_bucket = "${var.name_prefix}-build-src-${var.unique_suffix}"

  images = {
    web = {
      repository = var.repository_urls["web"]
      dockerfile = "Dockerfile"
    }
    ai = {
      repository = var.repository_urls["ai"]
      dockerfile = "backend/Dockerfile"
    }
  }
}

resource "aws_s3_bucket" "source" {
  bucket        = local.source_bucket
  force_destroy = var.force_destroy
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "source" {
  bucket                  = aws_s3_bucket.source.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "source" {
  bucket = aws_s3_bucket.source.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# L'archive de source n'a aucune valeur passé le build : la garder revient à
# payer le stockage d'un instantané que git conserve déjà mieux.
resource "aws_s3_bucket_lifecycle_configuration" "source" {
  bucket = aws_s3_bucket.source.id

  rule {
    id     = "expire-sources"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }
  }
}

# ─── Rôle du projet ────────────────────────────────────────

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "build" {
  name               = "${var.name_prefix}-image-builder"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "build" {
  name = "build-and-push"
  role = aws_iam_role.build.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.build.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.source.arn}/*"
      },
      {
        # Le jeton d'authentification au registre n'est pas bornable à un
        # dépôt : il vaut pour le registre du compte. Les actions qui écrivent,
        # elles, le sont — et ce sont les seules qui comptent.
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = values(var.repository_arns)
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "build" {
  name              = "/aws/codebuild/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ─── Projets ───────────────────────────────────────────────

resource "aws_codebuild_project" "image" {
  for_each = local.images

  name          = "${var.name_prefix}-${each.key}"
  description   = "Construit et pousse l'image ${each.key} de ${var.name_prefix}."
  service_role  = aws_iam_role.build.arn
  build_timeout = 40
  tags          = var.tags

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type = var.compute_type
    # Image standard d'AWS : Docker y est déjà installé, ce qui évite de
    # l'installer à chaque build.
    image = "aws/codebuild/amazonlinux2-x86_64-standard:5.0"
    type  = "LINUX_CONTAINER"
    # Requis pour `docker build` : sans mode privilégié, le démon ne peut pas
    # démarrer dans le conteneur de build et chaque build échoue au premier
    # appel Docker.
    privileged_mode = true

    environment_variable {
      name  = "REPOSITORY"
      value = each.value.repository
    }

    environment_variable {
      name  = "DOCKERFILE"
      value = each.value.dockerfile
    }

    environment_variable {
      name  = "AWS_REGION"
      value = var.region
    }

    # Valeurs publiques compilées DANS le bundle client par Next.js. Elles ne
    # sont pas secrètes — elles partent dans le navigateur — mais elles doivent
    # être présentes au build, pas à l'exécution : une image construite sans
    # elles sert une application qui ne sait pas joindre Supabase.
    environment_variable {
      name  = "NEXT_PUBLIC_SUPABASE_URL"
      value = var.supabase_url
    }

    environment_variable {
      name  = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
      value = var.supabase_anon_key
    }

    environment_variable {
      name  = "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
      value = var.vapid_public_key
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.build.name
      stream_name = each.key
    }
  }

  source {
    type     = "S3"
    location = "${aws_s3_bucket.source.bucket}/${var.source_key}"

    buildspec = <<-SPEC
      version: 0.2
      phases:
        pre_build:
          commands:
            - aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$${REPOSITORY%%/*}"
        build:
          commands:
            # BUILD_TAG est passe au demarrage du build (--environment-variables-override),
            # pour que le tag corresponde au commit deploye plutot qu'a l'heure du build.
            - TAG="$${BUILD_TAG:-latest}"
            - |
              docker build \
                --file "$DOCKERFILE" \
                --build-arg "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
                --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
                --build-arg "NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY" \
                --build-arg "BUILD_ID=$TAG" \
                --tag "$REPOSITORY:$TAG" \
                --tag "$REPOSITORY:latest" \
                .
        post_build:
          commands:
            - docker push "$REPOSITORY:$TAG"
            # :latest sert d'amorce : les overlays sortent d'usine avec
            # newTag: latest, donc la premiere reconciliation a une image a tirer.
            - docker push "$REPOSITORY:latest"
    SPEC
  }
}

# ─── Construction dans le cluster ──────────────────────────
#
# CodeBuild est le chemin prevu, mais il n'est pas toujours disponible : sur un
# compte AWS recent, TOUS les quotas de builds concurrents valent zero jusqu'a
# ce qu'une demande d'augmentation soit accordee, et `StartBuild` echoue alors
# sur « Cannot have more than 0 builds in queue for the account ». Le compte est
# sain, le projet est correct, et rien ne peut demarrer.
#
# Ce role donne la meme capacite a un Job Kubernetes (Kaniko) : meme archive de
# source dans S3, memes depots ECR, meme bornage des droits. Le cluster est deja
# la, donc l'amorcage ne depend plus d'un quota qu'on ne controle pas.

data "aws_iam_policy_document" "pod_assume" {
  count = var.enable_in_cluster_builder ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_issuer_url}:sub"
      values   = ["system:serviceaccount:${var.builder_namespace}:${var.builder_service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_issuer_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pod" {
  count              = var.enable_in_cluster_builder ? 1 : 0
  name               = "${var.name_prefix}-image-builder-pod"
  assume_role_policy = data.aws_iam_policy_document.pod_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "pod" {
  count = var.enable_in_cluster_builder ? 1 : 0
  name  = "build-and-push"
  role  = aws_iam_role.pod[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.source.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.source.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = values(var.repository_arns)
      },
    ]
  })
}

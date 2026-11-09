/**
 * Module cicd — la chaîne de livraison, dans AWS.
 *
 * ─── Pourquoi CodeBuild seul, et pas CodePipeline ───
 *
 * CodePipeline exige une connexion CodeConnections vers GitHub, et cette
 * connexion naît en état « PENDING » : elle ne devient utilisable qu'après
 * qu'un humain a cliqué « Update pending connection » dans la console. Un
 * environnement qui ne peut pas se reconstruire sans ce geste n'est plus
 * reproductible, et c'est précisément la propriété qu'on cherche à tenir.
 *
 * CodeBuild, lui, s'authentifie auprès de GitHub par un jeton — le même que
 * celui dont Flux se sert déjà — et sait poser son propre webhook. La chaîne
 * complète tient donc dans un `terraform apply`, sans passage par la console.
 *
 * ─── Ce que fait le projet, et dans quel ordre ───
 *
 *   1. barrières de qualité : typecheck, lint, budget d'actifs statiques,
 *      résolution des dépendances Python et tests backend ;
 *   2. construction des deux images, scan Trivy, poussée dans ECR ;
 *   3. déplacement du tag dans l'overlay de l'environnement, commit, push.
 *
 * ⚠️ CE COMPTE NE PEUT PAS ENCORE EXECUTER DE BUILD. Les projets se creent
 * (quota « Build projects » a 5000), mais tout demarrage est refuse par
 * « AccountLimitExceededException: Cannot have more than 0 builds in queue for
 * the account » — verifie a l'appel direct de StartBuild, et visible cote
 * GitHub sous la forme d'une livraison de webhook en 400. C'est la meme porte
 * que celle qui refuse les NLB et CloudFront : un compte neuf, non verifie. Un
 * seul ticket au support AWS les ouvre toutes les trois.
 *
 * En attendant, scripts/aws-build-images-incluster.sh fait le meme travail
 * depuis le cluster (Kaniko), tag compris. Le pipeline reprend la main sans
 * modification des que la limite est levee.
 *
 * L'étape 3 est le déploiement. Il n'y a pas de `kubectl` ici, et c'est
 * volontaire : Flux réconcilie la branche, donc le dépôt reste la seule source
 * de vérité et le pipeline n'a besoin d'aucun accès au cluster. Une panne du
 * pipeline ne peut pas laisser le cluster dans un état que git ignore.
 *
 * ─── La boucle qu'il faut fermer ───
 *
 * Le push de l'étape 3 modifie la branche que le webhook surveille. Sans
 * précaution, chaque build en déclenche un autre, indéfiniment. Le filtre
 * FILE_PATH ci-dessous exclut les commits qui ne touchent que l'overlay : le
 * commit de tag ne redéclenche donc rien.
 *
 * On n'utilise PAS le marqueur « [skip ci] » pour cela. Il a déjà coûté cher
 * ici : un fournisseur de CI qui ignore un push dès que N'IMPORTE LEQUEL de ses
 * commits porte le marqueur rend muet un push de promotion qui, lui, contient
 * du vrai code.
 */

locals {
  # Le jeton sert deux fois : à cloner, et à repousser le commit de tag. Il
  # vient de Secrets Manager, jamais du code ni des variables d'environnement
  # du projet — une variable d'environnement CodeBuild est lisible par
  # quiconque peut décrire le projet.
  github_token_secret = "${var.secret_prefix}/github-token"
}

# ─── Identifiants GitHub ───────────────────────────────────
#
# Ressource RÉGIONALE et de portée COMPTE : un seul identifiant GitHub par
# région, partagé par tous les projets CodeBuild qui s'y trouvent. D'où
# l'interrupteur : deux environnements dans la même région se disputeraient la
# ressource, et le second apply écraserait le premier sans le dire.

resource "aws_codebuild_source_credential" "github" {
  count = var.enable_codebuild && var.manage_source_credential ? 1 : 0

  auth_type   = "PERSONAL_ACCESS_TOKEN"
  server_type = "GITHUB"
  token       = var.github_token
}

resource "aws_secretsmanager_secret" "github_token" {
  count = var.enable_codebuild ? 1 : 0

  name                    = local.github_token_secret
  description             = "Jeton GitHub utilise par CodeBuild pour cloner et pour repousser le commit de tag."
  recovery_window_in_days = var.secret_recovery_window_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "github_token" {
  count = var.enable_codebuild ? 1 : 0

  secret_id     = aws_secretsmanager_secret.github_token[0].id
  secret_string = var.github_token
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
  count = var.enable_codebuild ? 1 : 0

  name               = "${var.name_prefix}-cicd"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_cloudwatch_log_group" "build" {
  count = var.enable_codebuild ? 1 : 0

  name              = "/aws/codebuild/${var.name_prefix}-cicd"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role_policy" "build" {
  count = var.enable_codebuild ? 1 : 0

  name = "cicd"
  role = aws_iam_role.build[0].id

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
        Resource = "${aws_cloudwatch_log_group.build[0].arn}:*"
      },
      {
        # Le jeton d'authentification au registre vaut pour le registre du
        # compte et n'est pas bornable ; les actions qui ECRIVENT, elles, le
        # sont — et ce sont les seules qui comptent.
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
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.github_token[0].arn
      },
    ]
  })
}

# ─── Le projet ─────────────────────────────────────────────

resource "aws_codebuild_project" "main" {
  count = var.enable_codebuild ? 1 : 0

  name           = "${var.name_prefix}-cicd"
  description    = "Barrieres de qualite, construction des images, deplacement du tag pour ${var.name_prefix}."
  service_role   = aws_iam_role.build[0].arn
  build_timeout  = var.build_timeout
  queued_timeout = 60
  tags           = var.tags

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type = var.compute_type
    image        = "aws/codebuild/amazonlinux2-x86_64-standard:5.0"
    type         = "LINUX_CONTAINER"
    # `docker build` a besoin du démon, qui a besoin du mode privilégié. Sans
    # lui le build échoue au premier appel Docker.
    privileged_mode = true

    environment_variable {
      name  = "AWS_REGION"
      value = var.region
    }

    environment_variable {
      name  = "ENV_NAME"
      value = var.env
    }

    environment_variable {
      name  = "BRANCH"
      value = var.branch
    }

    environment_variable {
      name  = "ECR_REPO_WEB"
      value = var.repository_urls["web"]
    }

    environment_variable {
      name  = "ECR_REPO_AI"
      value = var.repository_urls["ai"]
    }

    # Valeurs publiques compilées DANS le bundle client par Next.js : elles
    # doivent exister au build, pas à l'exécution. Une image construite sans
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

    # Le jeton n'est PAS une variable en clair : CodeBuild le résout depuis
    # Secrets Manager au démarrage du build, et il n'apparaît ni dans la
    # description du projet ni dans les journaux.
    environment_variable {
      name  = "GITHUB_TOKEN"
      type  = "SECRETS_MANAGER"
      value = aws_secretsmanager_secret.github_token[0].name
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.build[0].name
      stream_name = "build"
    }
  }

  source {
    type            = "GITHUB"
    location        = var.repository_url
    git_clone_depth = 0 # profondeur complète : le commit de tag est rebasé sur la branche
    buildspec       = file("${path.module}/buildspec.yml")

    git_submodules_config {
      fetch_submodules = false
    }
  }

  source_version = "refs/heads/${var.branch}"

  depends_on = [aws_codebuild_source_credential.github]
}

# ─── Déclenchement ─────────────────────────────────────────

resource "aws_codebuild_webhook" "main" {
  count = var.enable_codebuild && var.enable_webhook ? 1 : 0

  project_name = aws_codebuild_project.main[0].name
  build_type   = "BUILD"

  # Les deux filtres d'un même groupe sont un ET : un push, sur CETTE branche,
  # qui touche autre chose que l'overlay.
  filter_group {
    filter {
      type    = "EVENT"
      pattern = "PUSH"
    }

    filter {
      type    = "HEAD_REF"
      pattern = "^refs/heads/${var.branch}$"
    }

    # C'est ce filtre qui ferme la boucle : le commit de tag que le build
    # pousse lui-même ne touche que l'overlay, donc il ne redéclenche rien.
    filter {
      type                    = "FILE_PATH"
      pattern                 = "^infra/k8s/overlays/.*"
      exclude_matched_pattern = true
    }
  }
}

# ─── Notification ──────────────────────────────────────────
#
# Un build qui échoue en silence est un déploiement qu'on croit parti. La règle
# ci-dessous pousse les échecs sur le même sujet SNS que les alarmes
# d'infrastructure, pour qu'il n'y ait qu'un seul endroit à surveiller.

resource "aws_cloudwatch_event_rule" "build_failed" {
  count = var.enable_codebuild && var.alerts_topic_arn != "" ? 1 : 0

  name        = "${var.name_prefix}-cicd-failed"
  description = "Echec du pipeline ${var.name_prefix}"
  tags        = var.tags

  event_pattern = jsonencode({
    source      = ["aws.codebuild"]
    detail-type = ["CodeBuild Build State Change"]
    detail = {
      "build-status" = ["FAILED", "STOPPED"]
      "project-name" = [aws_codebuild_project.main[0].name]
    }
  })
}

resource "aws_cloudwatch_event_target" "build_failed" {
  count = var.enable_codebuild && var.alerts_topic_arn != "" ? 1 : 0

  rule      = aws_cloudwatch_event_rule.build_failed[0].name
  target_id = "sns"
  arn       = var.alerts_topic_arn
}

# ─── GitHub Actions ────────────────────────────────────────
#
# Le chemin retenu tant que le compte refuse d'executer un build CodeBuild.
#
# AUCUN SECRET N'EST STOCKE DANS GITHUB, et c'est la propriete qui compte : le
# workflow presente un jeton OIDC signe par GitHub, AWS verifie qu'il vient bien
# de CE depot et de CETTE branche, puis delivre des identifiants temporaires. Il
# n'y a donc pas de cle longue duree a poser, a faire tourner, ni a revoquer si
# quelqu'un quitte l'equipe. Le commit de tag, lui, est pousse avec le jeton que
# GitHub fournit nativement au workflow.
#
# Le fournisseur OIDC lui-meme est declare dans le module stack, et non ici :
# le role du pipeline ne peut pas etre construit sans lui, et ce module a besoin
# du role. Les garder ensemble ferait un cycle.


# Les valeurs dont le workflow a besoin AU BUILD. Elles ne sont pas secretes —
# elles partent dans le bundle client — mais elles sont propres a
# l'environnement, et les ecrire dans le workflow reviendrait a remettre dans
# git ce que toute cette conception en sort. Le workflow les lit avec le role
# qu'il vient d'assumer.
resource "aws_ssm_parameter" "build_config" {
  count = var.enable_github_actions ? 1 : 0

  name        = "/${var.name_prefix}/ci/build-config"
  description = "Valeurs de build de ${var.name_prefix}, lues par le workflow GitHub Actions."
  type        = "String"
  tags        = var.tags

  value = jsonencode({
    region            = var.region
    env               = var.env
    branch            = var.branch
    web_repo          = var.repository_urls["web"]
    ai_repo           = var.repository_urls["ai"]
    supabase_url      = var.supabase_url
    supabase_anon_key = var.supabase_anon_key
    vapid_public_key  = var.vapid_public_key
  })
}

resource "aws_iam_role_policy" "github_actions_read_config" {
  count = var.enable_github_actions && var.cicd_role_name != "" ? 1 : 0

  name = "read-build-config"
  role = var.cicd_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = aws_ssm_parameter.build_config[0].arn
    }]
  })
}

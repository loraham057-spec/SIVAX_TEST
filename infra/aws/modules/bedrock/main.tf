/**
 * Module bedrock — accès aux modèles de langage managés, pendant du module
 * openai côté Azure.
 *
 * Deux différences de nature avec Azure OpenAI, et elles simplifient :
 *
 *  · Il n'y a rien à provisionner. Bedrock n'a ni compte ni déploiement de
 *    modèle à créer : on autorise un rôle à invoquer un identifiant de modèle.
 *    Ce module est donc une politique IAM et une journalisation, pas une
 *    ressource de calcul.
 *
 *  · L'accès à un modèle doit être demandé une fois par compte, dans la
 *    console (Bedrock → Model access). Terraform ne peut pas le faire ; un
 *    appel à un modèle non débloqué échoue en AccessDeniedException alors que
 *    la politique IAM, elle, est correcte. C'est l'équivalent de la demande de
 *    quota TPM côté Azure : à faire AVANT la première mise en charge.
 *
 * Le routage de coût de l'agent se retrouve dans `model_ids` : un modèle
 * modeste pour la classification d'intention, la clarification et la
 * régénération de vérification — dont l'utilisateur ne lit jamais la sortie —
 * et un modèle capable pour le seul nœud qui rédige la réponse.
 */

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Les modèles de fondation sont adressés par un ARN régional sans compte ; les
  # profils d'inférence inter-régions, eux, portent le compte. On autorise les
  # deux formes, faute de quoi un identifiant préfixé (eu.anthropic…) est refusé.
  model_arns = concat(
    [for m in var.model_ids : "arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/${m}"],
    [for m in var.model_ids : "arn:aws:bedrock:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:inference-profile/${m}"],
  )
}

resource "aws_iam_role_policy" "invoke" {
  for_each = var.user_role_names
  name     = "bedrock-invoke"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = local.model_arns
      },
      {
        # Lister les modèles disponibles n'expose rien et évite au code de
        # coder en dur ce que le compte a débloqué.
        Effect   = "Allow"
        Action   = ["bedrock:ListFoundationModels", "bedrock:GetFoundationModel"]
        Resource = "*"
      },
    ]
  })
}

# ─── Journalisation des invocations ────────────────────────
#
# Ce qui rend une dépense LLM auditable : chaque appel, son modèle et sa
# consommation de jetons. C'est la source de vérité quand le budget dérape.

resource "aws_cloudwatch_log_group" "invocations" {
  count             = var.enable_invocation_logging ? 1 : 0
  name              = "/aws/bedrock/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "logging_assume" {
  count = var.enable_invocation_logging ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "logging" {
  count              = var.enable_invocation_logging ? 1 : 0
  name               = "role-bedrock-logs-${var.name_prefix}"
  assume_role_policy = data.aws_iam_policy_document.logging_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "logging" {
  count = var.enable_invocation_logging ? 1 : 0
  name  = "write-invocation-logs"
  role  = aws_iam_role.logging[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.invocations[0].arn}:*"
    }]
  })
}

# Un seul réglage par compte et par région : deux environnements dans le même
# compte se disputeraient cette ressource, d'où l'interrupteur explicite plutôt
# qu'une activation implicite.
resource "aws_bedrock_model_invocation_logging_configuration" "main" {
  count = var.enable_invocation_logging ? 1 : 0

  logging_config {
    embedding_data_delivery_enabled = false
    image_data_delivery_enabled     = false
    text_data_delivery_enabled      = var.log_prompt_text

    cloudwatch_config {
      log_group_name = aws_cloudwatch_log_group.invocations[0].name
      role_arn       = aws_iam_role.logging[0].arn
    }
  }

  depends_on = [aws_iam_role_policy.logging]
}

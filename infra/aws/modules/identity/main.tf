/**
 * Module identity — un rôle IAM par charge de travail (IRSA).
 *
 * Des rôles séparés plutôt qu'un principal partagé : le job ETL écrit dans
 * l'entrepôt et lit les identifiants DHIS2, l'application web n'a besoin ni de
 * l'un ni de l'autre. Les séparer signifie qu'une compromission n'hérite pas
 * des droits des autres, et que la trace d'audit nomme l'appelant réel.
 *
 * Aucune charge ne détient de clé d'accès AWS. Le ServiceAccount présente son
 * jeton projeté au fournisseur OIDC du cluster, et STS rend des identifiants
 * temporaires. Les NOMS des ServiceAccount sont porteurs : ils forment la
 * condition `sub` de la politique de confiance ci-dessous et doivent
 * correspondre exactement à k8s/base/serviceaccounts.yaml — les renommer casse
 * l'échange de jeton à l'exécution, pas au déploiement.
 *
 * Les politiques d'accès aux ressources (S3, Secrets Manager, ECR, Bedrock)
 * ne sont pas ici : chaque module de service attache la sienne à ces rôles,
 * pour que la lecture d'un module dise tout ce qu'il autorise.
 */

locals {
  oidc_issuer_host = replace(var.oidc_issuer_url, "https://", "")
}

data "aws_iam_policy_document" "irsa" {
  for_each = var.service_accounts

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    # Le couple sub/aud est ce qui rend le rôle inassumable par un autre pod :
    # sans la condition `aud`, tout jeton du même émetteur conviendrait.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:sub"
      values   = ["system:serviceaccount:${var.kubernetes_namespace}:${each.key}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workloads" {
  for_each = var.service_accounts

  name               = each.value
  assume_role_policy = data.aws_iam_policy_document.irsa[each.key].json
  tags               = merge(var.tags, { workload = each.key })
}

# ─── Rôle du pipeline ──────────────────────────────────────
#
# Pousse les images et lance Terraform. Fédéré à GitHub Actions quand un dépôt
# est déclaré ; sinon assumable par les principaux listés — c'est le point
# d'entrée à donner à Azure DevOps ou à un autre orchestrateur, sans jamais
# créer de clé d'accès longue durée.

data "aws_iam_policy_document" "cicd_assume" {
  count = var.create_cicd_role ? 1 : 0

  dynamic "statement" {
    for_each = var.github_oidc_provider_arn == "" ? [] : [1]
    content {
      actions = ["sts:AssumeRoleWithWebIdentity"]

      principals {
        type        = "Federated"
        identifiers = [var.github_oidc_provider_arn]
      }

      condition {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:aud"
        values   = ["sts.amazonaws.com"]
      }

      # Borné au dépôt ET à la branche : un fork ou une branche non prévue ne
      # peut pas assumer le rôle de déploiement.
      condition {
        test     = "StringLike"
        variable = "token.actions.githubusercontent.com:sub"
        values   = var.github_subjects
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.cicd_trusted_principal_arns) == 0 ? [] : [1]
    content {
      actions = ["sts:AssumeRole"]

      principals {
        type        = "AWS"
        identifiers = var.cicd_trusted_principal_arns
      }
    }
  }
}

resource "aws_iam_role" "cicd" {
  count              = var.create_cicd_role ? 1 : 0
  name               = var.names.role_cicd
  assume_role_policy = data.aws_iam_policy_document.cicd_assume[0].json
  tags               = merge(var.tags, { workload = "cicd" })

  lifecycle {
    # Un rôle sans personne pour l'assumer est une politique de confiance vide,
    # qu'IAM refuse avec un message qui ne dit pas d'où vient le problème.
    precondition {
      condition     = var.github_oidc_provider_arn != "" || length(var.cicd_trusted_principal_arns) > 0
      error_message = "create_cicd_role exige github_oidc_provider_arn ou cicd_trusted_principal_arns."
    }
  }
}

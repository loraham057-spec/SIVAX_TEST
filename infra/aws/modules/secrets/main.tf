/**
 * Module secrets — le seul endroit où une valeur secrète a le droit de vivre.
 *
 * Pendant du module keyvault : mêmes noms de secrets (database-url, redis-url,
 * openai-api-key…), préfixés par <projet>/<env>, ce qui borne la politique de
 * lecture des charges de travail à un seul préfixe ARN.
 *
 * Trois secrets sont ENGENDRÉS et non fournis, pour les mêmes raisons que côté
 * Azure :
 *
 *  · push-internal-token — l'application retombe sinon sur un littéral publié
 *    dans le dépôt (SEC-02). L'engendrer ferme ce chemin ; l'ancienne valeur
 *    reste à révoquer séparément.
 *
 *  · app-settings-encryption-key — l'application la dérive de
 *    SUPABASE_SERVICE_ROLE_KEY quand elle est absente (SEC-09), si bien qu'une
 *    rotation de cette clé rendrait tout réglage stocké définitivement
 *    indéchiffrable. Elle doit exister AVANT toute migration.
 *
 *  · le mot de passe administrateur PostgreSQL, que personne n'a besoin de
 *    connaître.
 *
 * ⚠️ `recovery_window_days` mérite une lecture. À zéro, un secret détruit
 * disparaît immédiatement et le nom est réutilisable tout de suite — c'est ce
 * qui rend `terraform destroy` suivi d'`apply` possible en dev. À sept ou
 * trente, le nom reste réservé pendant la fenêtre et un nouvel apply échoue sur
 * « a secret with this name is already scheduled for deletion ». Le comportement
 * sûr en production est justement celui qui bloque une reconstruction rapide.
 */

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ─── Clé KMS ───────────────────────────────────────────────
#
# Facultative : sans elle, Secrets Manager chiffre avec la clé gérée par AWS.
# Une clé propre ajoute la trace de chaque déchiffrement et la possibilité de
# révoquer l'accès d'un coup, pour environ 1 USD par mois.

resource "aws_kms_key" "secrets" {
  count                   = var.create_kms_key ? 1 : 0
  description             = "Chiffrement des secrets et des Secrets Kubernetes — ${var.name_prefix}"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_days
  tags                    = var.tags
}

resource "aws_kms_alias" "secrets" {
  count         = var.create_kms_key ? 1 : 0
  name          = "alias/${var.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets[0].key_id
}

# La politique de clé doit nommer EKS explicitement, sinon le chiffrement
# d'enveloppe des Secrets Kubernetes échoue à la création du cluster.
resource "aws_kms_key_policy" "secrets" {
  count  = var.create_kms_key ? 1 : 0
  key_id = aws_kms_key.secrets[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountRoot"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "EksEnvelopeEncryption"
        Effect    = "Allow"
        Principal = { Service = "eks.amazonaws.com" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant"]
        Resource  = "*"
      },
    ]
  })
}

# ─── Secrets engendrés ─────────────────────────────────────

resource "random_password" "postgres_admin" {
  length  = 32
  special = true
  # RDS refuse /, @, " et l'espace dans un mot de passe maître ; les laisser
  # passer produit un échec de création dont le message ne cite pas le caractère.
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "push_internal_token" {
  length  = 48
  special = false
}

resource "random_password" "app_settings_encryption_key" {
  length  = 64
  special = false
}

locals {
  generated_secrets = {
    "postgres-admin-password"     = random_password.postgres_admin.result
    "push-internal-token"         = random_password.push_internal_token.result
    "app-settings-encryption-key" = random_password.app_settings_encryption_key.result
  }

  # Les secrets tiers arrivent par TF_VAR_* : leur valeur est connue au plan
  # (littéral ou vide), donc les vides peuvent être écartés sans risque — un
  # environnement doit pouvoir monter avant que chaque intégration existe. Les
  # chaînes de connexion, elles, sont inconnues au plan et passent par
  # `computed_secrets` : elles ne doivent jamais piloter le filtre ni le jeu de
  # clés de for_each.
  supplied_secrets = { for k, v in var.secrets : k => v if v != "" }

  all_secrets = merge(local.generated_secrets, local.supplied_secrets, var.computed_secrets)

  secret_arn_prefix = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:${var.secret_prefix}/*"
}

# for_each itère sur les NOMS (non sensibles, connus au plan) ; la valeur — qui
# peut être sensible ou calculée — est cherchée dans le corps. Passer la map
# elle-même échoue : Terraform refuse une valeur sensible comme clé d'instance.
resource "aws_secretsmanager_secret" "main" {
  for_each = nonsensitive(toset(keys(local.all_secrets)))

  name                    = "${var.secret_prefix}/${each.key}"
  description             = "Gere par Terraform — ne pas editer a la main."
  kms_key_id              = var.create_kms_key ? aws_kms_key.secrets[0].arn : null
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "main" {
  for_each = aws_secretsmanager_secret.main

  secret_id     = each.value.id
  secret_string = local.all_secrets[each.key]
}

# ─── Lecture par les charges de travail ────────────────────
#
# Bornée au préfixe de l'environnement : le rôle `web` de dev ne peut pas lire
# un secret de prod, même si les deux comptes étaient fusionnés.

resource "aws_iam_role_policy" "readers" {
  for_each = var.reader_role_names
  name     = "secrets-read"
  role     = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect   = "Allow"
          Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
          Resource = local.secret_arn_prefix
        },
        {
          Effect   = "Allow"
          Action   = ["secretsmanager:ListSecrets"]
          Resource = "*"
        },
      ],
      var.create_kms_key ? [
        {
          Effect   = "Allow"
          Action   = ["kms:Decrypt"]
          Resource = aws_kms_key.secrets[0].arn
        }
      ] : [],
    )
  })
}

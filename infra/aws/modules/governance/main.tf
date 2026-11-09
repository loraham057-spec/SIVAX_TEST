/**
 * Module governance — garde-fous de compte et services de détection.
 *
 * Le filet de sécurité derrière la conception réseau : les services de données
 * sont déjà privés, et ce qui suit rend difficile de les dé-priver plus tard
 * sans que personne ne le voie. Cela compte plus qu'ailleurs sur une
 * plateforme qui porte des données de santé nationales, où la différence entre
 * « configuré privé » et « ne peut pas être public » est ce qu'un auditeur
 * demande.
 *
 * Différence de nature avec Azure Policy, à connaître : une Service Control
 * Policy, qui serait le vrai équivalent d'un refus, s'écrit au niveau de
 * l'organisation et pas du compte. Ce module fait donc ce qu'un compte isolé
 * peut faire — bloquer l'accès public S3 pour tout le compte, et allumer la
 * détection — et laisse les protections irréversibles là où elles vivent
 * vraiment : `deletion_protection` sur RDS, la fenêtre de récupération des
 * secrets, `force_destroy` sur les buckets.
 */

# Un cran au-dessus du blocage par bucket : plus aucun bucket du compte ne peut
# devenir public, même créé à la main hors de Terraform.
#
# ⚠️ Incompatible avec `assets_public_read` du module s3-assets. Les deux ne
# doivent jamais être vrais ensemble : ici on refuse ce que là-bas on autorise,
# et c'est ce refus qui gagne. La pile le vérifie explicitement.
resource "aws_s3_account_public_access_block" "main" {
  count = var.block_public_s3_account_wide ? 1 : 0

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Détection ─────────────────────────────────────────────

# GuardDuty : analyse les journaux CloudTrail, DNS et VPC pour signaler ce qui
# ressemble à une compromission. Facturé à l'usage, quelques euros par mois sur
# un compte de cette taille.
resource "aws_guardduty_detector" "main" {
  count  = var.enable_guardduty ? 1 : 0
  enable = true
  tags   = var.tags

  datasources {
    s3_logs {
      enable = true
    }
    kubernetes {
      audit_logs {
        enable = true
      }
    }
  }
}

# Security Hub agrège les constats de GuardDuty et des socles de conformité.
resource "aws_securityhub_account" "main" {
  count = var.enable_security_hub ? 1 : 0
}

resource "aws_securityhub_standards_subscription" "foundational" {
  count         = var.enable_security_hub ? 1 : 0
  standards_arn = "arn:aws:securityhub:${var.region}::standards/aws-foundational-security-best-practices/v/1.0.0"

  depends_on = [aws_securityhub_account.main]
}

# IAM Access Analyzer : signale toute politique qui donne accès à une ressource
# depuis l'extérieur du compte. Gratuit, et c'est exactement la question qu'un
# auditeur pose.
resource "aws_accessanalyzer_analyzer" "main" {
  count         = var.enable_access_analyzer ? 1 : 0
  analyzer_name = "analyzer-${var.name_prefix}"
  type          = "ACCOUNT"
  tags          = var.tags
}

# Rien ici sur CloudTrail : l'historique des événements de gestion est actif
# par défaut sur 90 jours, ce qui couvre le besoin d'enquête de cette
# plateforme. Une piste dédiée n'a d'intérêt qu'avec un besoin de conservation
# plus long ou d'événements de données, et se pose alors au niveau de
# l'organisation — pas dans l'état d'un environnement.

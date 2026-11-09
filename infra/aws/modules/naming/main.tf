/**
 * Module naming — source unique des noms de ressources et des tags.
 *
 * Même rôle que son homologue Azure : aucun autre module ne compose un nom
 * localement, donc changer la convention est un changement d'un seul fichier.
 * Les noms suivent le schéma <type>-<projet>-<env>-<région courte> :
 *
 *     vpc-diav1-prod-ew3      eks-diav1-dev-ew3      psql-diav1-dev-ew3
 *
 * Deux contraintes AWS façonnent le code ci-dessous, symétriques de celles
 * d'Azure : les buckets S3 sont uniques MONDIALEMENT et n'acceptent que des
 * minuscules, des chiffres et des tirets ; les identifiants RDS et les noms de
 * dépôts ECR ont leurs propres jeux de caractères. Tout ce qui doit être
 * globalement unique reçoit le même suffixe déterministe de 4 caractères,
 * dérivé du compte et de l'environnement : stable d'un apply à l'autre, non
 * devinable depuis un autre compte.
 */

locals {
  # Région → code court. À étendre au fil des régions utilisées.
  region_short_map = {
    "eu-west-1"    = "ew1"
    "eu-west-2"    = "ew2"
    "eu-west-3"    = "ew3" # Paris
    "eu-central-1" = "ec1"
    "eu-north-1"   = "en1" # Stockholm
    "eu-south-1"   = "es1"
    "af-south-1"   = "af1"
    "us-east-1"    = "ue1"
  }

  region_short = lookup(local.region_short_map, var.region, replace(var.region, "-", ""))

  # Suffixe déterministe pour les noms globalement uniques.
  unique_suffix = substr(sha256("${var.account_id}-${var.project}-${var.env}"), 0, 4)

  base = "${var.project}-${var.env}"

  # Appliqués à chaque ressource. `data-classification` compte ici : la
  # plateforme porte des données de santé agrégées, et c'est ce tag que les
  # règles de gouvernance et la ventilation de coûts utilisent comme clé.
  tags = merge(
    {
      project               = var.project
      env                   = var.env
      owner                 = var.owner
      "cost-center"         = var.cost_center
      "data-classification" = var.data_classification
      "managed-by"          = "terraform"
    },
    var.extra_tags,
  )
}

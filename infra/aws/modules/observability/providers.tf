terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
      # Les métriques CloudFront ne sont publiées que dans us-east-1 : les
      # alarmes du bord doivent y être créées, quelle que soit la région de la
      # plateforme.
      configuration_aliases = [aws.us_east_1]
    }
  }
}

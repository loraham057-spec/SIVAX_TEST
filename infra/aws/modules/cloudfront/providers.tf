terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
      # Certificat ACM et WAF d'une distribution CloudFront doivent vivre en
      # us-east-1, quelle que soit la région de la plateforme.
      configuration_aliases = [aws.us_east_1]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

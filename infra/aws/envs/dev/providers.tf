terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.32"
    }
  }

  # Paramétré par -backend-config=backend.hcl, pour que le même code serve tous
  # les environnements tout en gardant un fichier d'état par environnement.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = var.project
      env        = "dev"
      managed-by = "terraform"
    }
  }
}

# Imposé par CloudFront : certificat, WAF et métriques du bord n'existent qu'en
# us-east-1, quelle que soit la région de la plateforme.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      project    = var.project
      env        = "dev"
      managed-by = "terraform"
    }
  }
}

# Les fournisseurs Kubernetes et Helm s'authentifient par un jeton EKS obtenu à
# l'exécution. Leur configuration dépend d'un cluster qui n'existe pas au
# premier plan : Terraform traite alors ces valeurs comme inconnues et diffère
# les ressources concernées, ce qui est exactement le comportement voulu.
#
# `aws eks get-token` exige que l'AWS CLI soit présente sur l'agent qui exécute
# Terraform. C'est la seule dépendance externe de cette configuration.
provider "kubernetes" {
  host                   = module.stack.cluster_endpoint
  cluster_ca_certificate = base64decode(module.stack.cluster_ca_certificate)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.stack.cluster_name, "--region", var.region]
  }
}

provider "helm" {
  kubernetes = {
    host                   = module.stack.cluster_endpoint
    cluster_ca_certificate = base64decode(module.stack.cluster_ca_certificate)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.stack.cluster_name, "--region", var.region]
    }
  }
}

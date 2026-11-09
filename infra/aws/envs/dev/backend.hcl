bucket         = "diav1-tfstate-431000516997"
key            = "aws/dev.terraform.tfstate"
region         = "eu-west-3"
dynamodb_table = "diav1-tfstate-lock"
encrypt        = true

# Verrouillage par table DynamoDB parce que ce dépôt est épinglé à Terraform
# 1.9.8 (infra/.terraform-version). À partir de 1.10, `use_lockfile = true`
# remplace la table par un objet .tflock déposé à côté de l'état — une
# ressource de moins à provisionner et à payer.
#
# L'authentification passe entièrement par l'environnement :
#   AWS_REGION, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY en local,
#   ou le rôle assumé par le pipeline (AWS_ROLE_ARN + jeton OIDC).

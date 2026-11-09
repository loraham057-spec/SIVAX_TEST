variable "region" {
  description = "Région AWS."
  type        = string
}

variable "names" {
  description = "Noms de ressources issus du module naming."
  type        = map(string)
}

variable "name_prefix" {
  description = "Préfixe <projet>-<env>."
  type        = string
}

variable "tags" {
  description = "Tags appliqués à chaque ressource."
  type        = map(string)
}

variable "private_subnet_ids" {
  description = "Sous-réseaux privés hébergeant les nœuds."
  type        = list(string)
}

variable "kubernetes_version" {
  description = "Version mineure de Kubernetes du plan de contrôle."
  type        = string
  default     = "1.31"
}

variable "private_cluster_enabled" {
  description = "Fermer l'accès public au serveur d'API. En production, oui — le pipeline doit alors atteindre l'API depuis le VPC."
  type        = bool
  default     = false
}

variable "api_allowed_cidrs" {
  description = "Adresses autorisées sur le point de terminaison public de l'API quand il reste ouvert."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enabled_log_types" {
  description = "Journaux du plan de contrôle. `audit` est le pendant de kube-audit-admin et le principal poste de coût."
  type        = list(string)
  default     = ["api", "audit", "authenticator"]
}

variable "log_retention_days" {
  description = "Rétention des journaux du plan de contrôle."
  type        = number
  default     = 30
}

variable "secrets_kms_key_arn" {
  description = "Clé KMS chiffrant les Secrets Kubernetes. Vide, le chiffrement par défaut d'EKS s'applique."
  type        = string
  default     = ""
}

# ─── Groupe de nœuds système ───────────────────────────────

variable "system_node_instance_type" {
  description = "Type d'instance du groupe système."
  type        = string
  default     = "t3a.medium"
}

variable "system_node_count" {
  description = "Taille du groupe système quand l'autoscaling est coupé."
  type        = number
  default     = 1
}

variable "system_autoscaling_enabled" {
  description = "Autoscaler le groupe système."
  type        = bool
  default     = false
}

variable "system_node_min_count" {
  description = "Plancher du groupe système."
  type        = number
  default     = 1
}

variable "system_node_max_count" {
  description = "Plafond du groupe système."
  type        = number
  default     = 2
}

variable "system_pool_dedicated" {
  description = "Souiller le groupe système (CriticalAddonsOnly) pour en écarter les pods applicatifs. À couper sur un environnement d'un seul groupe."
  type        = bool
  default     = true
}

# ─── Groupe de nœuds applicatif ────────────────────────────

variable "enable_user_pool" {
  description = "Créer un groupe de nœuds applicatif distinct."
  type        = bool
  default     = true
}

variable "user_node_instance_type" {
  description = "Type d'instance du groupe applicatif."
  type        = string
  default     = "t3a.medium"
}

variable "user_node_capacity_type" {
  description = "ON_DEMAND ou SPOT. SPOT divise la facture par trois mais l'instance peut être reprise avec deux minutes de préavis — acceptable pour un environnement de développement, pas pour la production."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.user_node_capacity_type)
    error_message = "user_node_capacity_type doit valoir ON_DEMAND ou SPOT."
  }
}

variable "user_node_count" {
  description = "Taille du groupe applicatif quand l'autoscaling est coupé."
  type        = number
  default     = 1
}

variable "user_autoscaling_enabled" {
  description = "Autoscaler le groupe applicatif."
  type        = bool
  default     = true
}

variable "user_node_min_count" {
  description = "Plancher du groupe applicatif."
  type        = number
  default     = 1
}

variable "user_node_max_count" {
  description = "Plafond du groupe applicatif."
  type        = number
  default     = 3
}

variable "node_disk_size" {
  description = "Taille du disque des nœuds, en Go."
  type        = number
  default     = 40
}

# ─── Accès ─────────────────────────────────────────────────

variable "admin_principal_arns" {
  description = "Principaux IAM (rôles ou utilisateurs) recevant l'accès administrateur au cluster."
  type        = list(string)
  default     = []
}

variable "deployer_principal_arn" {
  description = "Rôle utilisé par le pipeline. Reçoit l'accès administrateur, nécessaire pour annoter les objets Flux et diagnostiquer une réconciliation bloquée."
  type        = string
  default     = ""
}

variable "restrict_ingress_to_cdn" {
  description = "N'autoriser l'entrée que depuis la liste de préfixes CloudFront. Faux, 80/443 sont ouverts sur Internet — le seul chemin d'entrée quand le CDN est désactivé."
  type        = bool
  default     = false
}

variable "enable_container_insights" {
  description = "Add-on amazon-cloudwatch-observability. Mesuré coûteux en ressources sur un cluster d'un ou deux nœuds ; les traces applicatives passent par les sidecars OpenTelemetry."
  type        = bool
  default     = false
}

variable "chart_versions" {
  description = "Versions épinglées des charts Helm. Épinglées et non « latest » : une reconstruction doit produire le même cluster six mois plus tard."
  type = object({
    keda                       = string
    cluster_autoscaler         = string
    secrets_store_csi          = string
    secrets_store_aws_provider = string
  })
  default = {
    keda                       = "2.16.1"
    cluster_autoscaler         = "9.46.0"
    secrets_store_csi          = "1.4.6"
    secrets_store_aws_provider = "0.3.11"
  }
}

variable "vpc_cidr" {
  description = "CIDR du VPC. Sert a laisser passer les sondes de sante du NLB, qui viennent d'adresses internes."
  type        = string
}

variable "create_console_role" {
  description = <<-DESC
    Creer le role que l'on endosse depuis la console AWS pour voir et modifier
    les ressources Kubernetes.

    Il existe parce que le compte ROOT ne peut pas recevoir de droits
    Kubernetes : EKS refuse toute entree d'acces pour ce principal. Une console
    ouverte sous le root repond « Unauthorized » sur l'onglet Ressources, alors
    que kubectl fonctionne depuis un poste — un symptome qui se lit comme un
    cluster casse, sans l'etre.
  DESC
  type        = bool
  default     = true
}

variable "console_role_trusted_principal_arns" {
  description = "Principaux autorises a endosser le role console. Vide = le compte lui-meme, ce qui couvre le root et les utilisateurs IAM ayant sts:AssumeRole."
  type        = list(string)
  default     = []
}

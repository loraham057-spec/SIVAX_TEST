variable "name_prefix" {
  description = "Prefixe <projet>-<env>."
  type        = string
}

variable "tags" {
  description = "Tags appliques a chaque ressource."
  type        = map(string)
}

variable "vpc_id" {
  description = "VPC hebergeant le bord."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR du VPC — borne la sortie du bord vers les noeuds."
  type        = string
}

variable "public_subnet_ids" {
  description = "Sous-reseaux publics du load balancer. Deux zones au minimum : AWS refuse un ALB sur une seule."
  type        = list(string)
}

variable "node_security_group_id" {
  description = "Groupe de securite porte par les noeuds. Le module y ouvre les deux ports du Service, depuis le bord uniquement."
  type        = string
}

variable "node_autoscaling_groups" {
  description = "Groupes d'auto-scaling des noeuds, indexes par pool. Les cles doivent etre statiques : voir le commentaire de la ressource qui les consomme."
  type        = map(string)
  default     = {}
}

variable "ingress_http_node_port" {
  description = <<-DESC
    Port fixe du Service de l'ingress pour HTTP.

    FIXE, et non attribue par Kubernetes : c'est ce qui permet a Terraform de
    creer le groupe cible au meme apply que le cluster. Un port attribue
    dynamiquement ne serait connu qu'apres coup, et demanderait une seconde
    passe pour cabler le bord.
  DESC
  type        = number
  default     = 30080
}

variable "ingress_https_node_port" {
  description = "Port fixe du Service de l'ingress pour HTTPS. Ouvert cote noeuds, mais non utilise tant que le TLS s'arrete au bord."
  type        = number
  default     = 30443
}

variable "domain_name" {
  description = "Nom public servi par le bord. Vide, le bord sert en clair sur son propre nom DNS."
  type        = string
  default     = ""
}

variable "extra_domain_names" {
  description = "Noms supplementaires portes par le meme certificat et le meme bord."
  type        = list(string)
  default     = []
}

variable "wait_for_certificate" {
  description = "Attendre la validation ACM pendant l'apply. Faux tant que les enregistrements de validation ne sont pas poses au registrar."
  type        = bool
  default     = false
}

variable "idle_timeout" {
  description = "Secondes avant que le bord coupe une connexion inactive. Releve pour les reponses en flux du modele."
  type        = number
  default     = 120
}

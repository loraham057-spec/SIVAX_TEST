// dev — configuration non secrète.
//
// Les secrets sont fournis en TF_VAR_* et ne doivent jamais apparaître ici.

project = "diav1"

// eu-west-3 (Paris) : UE pour la résidence des données, latence la plus faible
// vers la RDC parmi les régions européennes, et catalogue complet — EKS,
// RDS PostgreSQL 16, ElastiCache, Bedrock y sont disponibles.
region = "eu-west-3"

alert_emails = []

// ─── DHIS2 / SNIS RDC ───
// Le mot de passe est un secret, injecté par TF_VAR_dhis2_password.
dhis2_base_url = "https://snisrdc.com"
dhis2_username = "Berly_Lora"
dhis2_root_ou  = "ymGeqzoPhN3"

// ─── Nom public ───
//
// Deux noms, et la distinction est importante :
//   · ingress_hostname est l'ORIGINE — un enregistrement A vers les IP
//     retournées par `terraform output ingress_ips`. CloudFront refuse une
//     adresse IP comme origine, d'où ce nom intermédiaire.
//   · custom_domain est le nom que voient les utilisateurs. Il porte le host de
//     la règle d'ingress et le sujet du certificat, et fait passer site_url en
//     https://.
//
// Le domaine ne peut PAS être vide tant que l'overlay pose un bloc TLS : un
// host vide fait rejeter l'Ingress par l'API Kubernetes. Tant que
// l'enregistrement A ne pointe pas encore ici, cert-manager échoue son défi et
// le site reste joignable en HTTP par l'en-tête Host ; le certificat s'émet
// seul dès la bascule DNS.
ingress_hostname = "origin-dev.sivax.health"
custom_domain    = "dev.sivax.health"

// CloudFront reste éteint au premier apply : la distribution ne peut pas
// joindre une origine dont l'enregistrement A n'existe pas encore. Passer à
// true une fois origin-dev.sivax.health résolu vers les IP d'ingress.
// Bord public : ALB + certificat ACM.
//
// CE COMPTE REFUSE LES DEUX BRIQUES PREVUES A L'ORIGINE, verifie en appelant
// les APIs directement : « OperationNotPermitted » sur la creation d'un NLB, et
// « Your account must be verified before you can add new CloudFront resources »
// sur CloudFront. L'ALB et le Classic, eux, passent.
//
// L'ALB n'est pas un pis-aller : il apporte le TLS gere par AWS (plus de defi
// ACME a faire aboutir), le routage par nom d'hote, et un nom DNS stable.
enable_cdn      = false
enable_edge_alb = true

// Les enregistrements de validation sont poses et les certificats sont emis :
// l'apply attend desormais la validation et pose l'ecouteur HTTPS. Tant que
// c'etait faux, le bord servait en clair sur son propre nom DNS — un ALB refuse
// net un certificat encore en attente, avec un message qui parle du certificat
// et non de son etat.
edge_wait_for_certificate = true

// Compte ACME. Facultatif : vide, le compte est anonyme et Let's Encrypt
// n'envoie aucun avis d'expiration.
acme_email = ""

// ─── Supabase (fournisseur d'identité, phase 1) ───
// La clé anon est publique par nature — elle part dans le navigateur — mais
// elle passe par une variable plutôt que par le dépôt, pour garder une seule
// règle pour toutes les clés.
supabase_url = "https://xqhiynjuyxtvptayrrjk.supabase.co"

// ─── Modèles de langage ───
// L'application appelle l'API OpenAI publique. Bedrock reste éteint tant que
// l'accès aux modèles n'a pas été demandé dans la console du compte.
enable_bedrock    = false
bedrock_model_ids = []

// ─── Pipeline ───
// À renseigner quand le rôle de déploiement est créé ici plutôt que fourni :
//   create_cicd_role = true
//   github_oidc_provider_arn = "arn:aws:iam::<compte>:oidc-provider/token.actions.githubusercontent.com"
//   github_subjects          = ["repo:<org>/<depot>:ref:refs/heads/dev"]
create_cicd_role = true

// Serveur d'API : ouvert, l'authentification IAM etant la barriere.
//
// C'est un CHANGEMENT DE POSITION, et il vaut d'etre explique. La liste
// d'adresses etait censee ajouter une seconde barriere devant le serveur
// d'API. En pratique elle n'a jamais protege que contre un attaquant non
// authentifie — le serveur refuse deja toute requete sans identifiants IAM
// valides — pendant qu'elle nous enfermait dehors a chaque changement
// d'adresse du fournisseur d'acces : trois fois en une journee, et chaque
// blocage ressemble a une panne de cluster plutot qu'a un pare-feu.
//
// Une regle qu'on doit rouvrir dans l'urgence ne protege rien : elle deplace
// seulement le risque vers le moment ou l'on repare a chaud. Les controles qui
// tiennent reellement sont ailleurs, et ils restent en place :
//   · l'authentification IAM et les entrees d'acces EKS (aws_eks_access_entry)
//     decident QUI parle au serveur ;
//   · le plan de donnees — RDS, ElastiCache — n'a aucune route vers Internet ;
//   · l'ingress n'est joignable que par CloudFront des que le CDN est actif.
//
// Rien ici ne designe une adresse IP : les origines et les cibles sont des noms
// DNS ou des ARN, qui survivent au remplacement des ressources sous-jacentes.
eks_api_allowed_cidrs = ["0.0.0.0/0"]

// ─── Chaine de livraison : GitHub Actions par federation OIDC ───
//
// Aucune cle AWS n'est deposee dans les secrets du depot. Le workflow presente
// un jeton signe par GitHub ; la condition `sub` ci-dessous borne la confiance
// a CE depot et a CETTE branche, de sorte qu'un fork, une pull request ou une
// autre branche ne peut pas assumer le role.
//
// dev porte le fournisseur OIDC, unique pour tout le compte ; prod recoit son
// ARN.
create_github_oidc_provider = true
github_subjects             = ["repo:fidelensadi/tbi_pfizer:ref:refs/heads/dev"]

// CodeBuild reste eteint tant que le compte refuse d'executer un build
// (« Cannot have more than 0 builds in queue for the account »).
cicd_enable_codebuild = false

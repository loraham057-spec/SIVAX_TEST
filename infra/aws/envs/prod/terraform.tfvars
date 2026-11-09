// prod — configuration non secrète.
//
// RÉGION DISTINCTE DE DEV, et c'est délibéré. Ce n'est plus, comme sur Azure,
// une contrainte de quota vCPU régional — AWS ne partage pas de quota entre
// deux environnements de cette taille — mais la séparation des rayons de
// souffle : une panne régionale, ou une manipulation dans la console, ne peut
// pas emporter les deux à la fois. eu-central-1 (Francfort) est en UE, mature,
// et propose EKS, RDS PostgreSQL 16 et Bedrock.
//
// Les secrets sont fournis en TF_VAR_* par le pipeline et ne doivent jamais
// apparaître ici.

project = "diav1"
region  = "eu-central-1"

alert_emails = []

// ─── Nom public ───
// ingress_hostname est l'origine (enregistrement A vers les IP d'ingress) ;
// custom_domain est le nom que voient les utilisateurs. Voir la note côté dev :
// le domaine ne peut pas être vide tant que l'overlay pose un bloc TLS.
ingress_hostname = "origin.sivax.health"
custom_domain    = "sivax.health"

// À passer à true une fois origin.sivax.health résolu vers les IP d'ingress :
// CloudFront refuse une adresse IP comme origine, et la validation de la
// variable enable_cdn le rappelle avant l'apply plutôt qu'après.
enable_cdn      = false
enable_edge_alb = true

// Les enregistrements de validation sont poses et les certificats sont emis :
// l'apply attend desormais la validation et pose l'ecouteur HTTPS. Tant que
// c'etait faux, le bord servait en clair sur son propre nom DNS — un ALB refuse
// net un certificat encore en attente, avec un message qui parle du certificat
// et non de son etat.
edge_wait_for_certificate = true

// Le nom racine et le www sur le meme bord : un seul certificat, une seule
// regle, et le www cesse d'etre un cas particulier a traiter plus tard.
extra_domain_names = ["www.sivax.health"]

// Le nom que l'application annonce, et il DIFFERE du premier nom du
// certificat. Un nom racine ne peut pas etre un CNAME — la norme DNS
// l'interdit — donc c'est le www qui resout. Annoncer l'apex faisait fabriquer
// a l'application des URL vers un nom absent du DNS : ERR_NAME_NOT_RESOLVED sur
// chaque appel d'API, sous une page encore servie par le cache du service
// worker. L'ingress et le certificat, eux, couvrent toujours les deux noms.
//
// A repasser sur "sivax.health" le jour ou l'apex resout (ALIAS chez le
// registrar).
canonical_host = "www.sivax.health"

acme_email = ""

// ─── DHIS2 / SNIS RDC ───
dhis2_base_url = "https://snisrdc.com"
dhis2_username = "Berly_Lora"
dhis2_root_ou  = "ymGeqzoPhN3"

// ─── Supabase ───
// prod réutilise le MÊME projet Supabase que dev (décision assumée : pas
// d'isolation dev/prod sur cette base). Sans cette URL, l'ETL échoue et la
// couche de données Supabase de prod est non fonctionnelle — l'agent ne trouve
// aucun indicateur. Les clés correspondantes (service_role_key, anon_key)
// doivent pointer sur CE projet, fournies en TF_VAR_* par le pipeline.
supabase_url = "https://xqhiynjuyxtvptayrrjk.supabase.co"

// ─── Modèles de langage ───
enable_bedrock    = false
bedrock_model_ids = []

// ─── Détection ───
// Quelques euros par mois chacun ; à activer une fois la plateforme porteuse.
enable_guardduty    = false
enable_security_hub = false

// ─── Pipeline ───
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
// un jeton signe par GitHub ; la condition `sub` ci-dessous est ce qui borne la
// confiance a CE depot et a CETTE branche, de sorte qu'un fork ou une autre
// branche ne peut pas assumer le role.
github_subjects = ["repo:fidelensadi/tbi_pfizer:ref:refs/heads/prod"]

// Le fournisseur OIDC est unique pour tout le compte : dev le porte, prod recoit son ARN.
github_oidc_provider_arn = "arn:aws:iam::431000516997:oidc-provider/token.actions.githubusercontent.com"

// CodeBuild reste eteint tant que le compte refuse d'executer un build
// (« Cannot have more than 0 builds in queue for the account »).
cicd_enable_codebuild = false

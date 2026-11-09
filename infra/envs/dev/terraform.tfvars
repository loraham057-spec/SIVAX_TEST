// dev — non-secret configuration.
//
// Secrets are supplied as TF_VAR_* and must never appear here. The values
// below come from the SIVAX environment configuration of the previous,
// non-Azure deployment; only the non-secret half of that file is reproduced.

project = "diav1"

// francecentral, not westeurope: this subscription is refused new storage
// accounts in westeurope ("the selected region is currently not accepting new
// customers"). francecentral accepts them, offers Azure OpenAI, and is the
// closest French-language region.
location        = "francecentral"
openai_location = "francecentral"

subscription_id = "62fc369a-68ad-4db3-89fb-1d522050ff40"

alert_emails = []

// ─── DHIS2 / SNIS RDC ───
// The password is a secret and is injected through TF_VAR_dhis2_password.
dhis2_base_url = "https://snisrdc.com"
dhis2_username = "Berly_Lora"
dhis2_root_ou  = "ymGeqzoPhN3"

// ─── Nom public ───
// Enregistrement A chez Hostinger : dev.sivax.health → IP publique de
// l'ingress. Renseigner ce domaine fait trois choses d'un coup : l'overlay dev
// pose le host et le bloc TLS sur l'Ingress, cert-manager demande un
// certificat Let's Encrypt pour ce nom, et public_url/site_url passent en
// https:// — c'est cette dernière valeur que l'application sert comme
// NEXT_PUBLIC_APP_URL.
// Le domaine ne peut PAS etre vide : patch-ingress-tls.yaml pose toujours un
// bloc tls, et un host vide fait rejeter l'Ingress par l'API Kubernetes
// (spec.tls[0].hosts[0] doit etre un sous-domaine RFC 1123). Tant que le
// record A ne pointe pas encore ici, cert-manager echoue son challenge et le
// site reste joignable en HTTP via l'en-tete Host ; le certificat s'emet seul
// des la bascule DNS.
custom_domain = "dev.sivax.health"

// Compte ACME. Facultatif : vide, le compte est anonyme et Let's Encrypt
// n'envoie aucun avis d'expiration. À renseigner pour les recevoir.
acme_email = ""

// ─── Supabase (identity provider, phase 1) ───
// The anon key is public by design — it ships to the browser — but it is
// passed as a variable rather than committed, to keep one rule for all keys.
supabase_url = "https://xqhiynjuyxtvptayrrjk.supabase.co"

// ─── Contraintes de l'abonnement ───
// Front Door : quota de profils à 0 sur cet abonnement ("the number of
// profiles created exceeds quota"), relevé uniquement par demande de support.
// dev sert donc directement depuis l'IP publique de l'ingress.
enable_frontdoor = false

// Terraform écrit les secrets depuis l'extérieur du VNet ; le pare-feu du
// coffre refuse tout le reste. Les charges de travail passent par le private
// endpoint.
// 216.247.106.19 : poste depuis lequel Terraform est lancé à la main. Sans
// cette entrée, le premier apply retire l'IP courante de la liste et la
// machine qui vient de lancer Terraform perd l'accès plan-données au coffre —
// le plan suivant échoue alors au rafraîchissement des azurerm_key_vault_secret.
key_vault_allowed_ips = ["86.68.140.248"]

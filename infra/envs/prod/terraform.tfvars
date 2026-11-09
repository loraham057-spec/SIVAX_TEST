// prod — non-secret configuration.
//
// RÉGION DISTINCTE DE DEV, ET C'EST LA RAISON D'ÊTRE DU CHOIX. Le quota vCPU
// est régional : dev et prod dans la même région se partagent 10 vCPU, ce qui
// ne laisse à aucun des deux la marge d'un autoscale ou du surge de 33 % d'un
// upgrade. En swedencentral la prod dispose de ses propres 10 vCPU (vérifié :
// 0 consommé), et le quota de dev en francecentral cesse d'être disputé.
//
// swedencentral plutôt qu'une autre : UE (résidence des données), région
// mature au catalogue complet, et les trois vérifications qui comptent sont
// passées — famille Dsv6 sans restriction régionale, PostgreSQL Burstable B2s
// et PG 16 disponibles, AKS 1.34 proposé. westeurope est écartée, l'abonnement
// y refuse les nouveaux comptes de stockage.
// Secrets are supplied as TF_VAR_* by the CI and must never appear here.

project  = "diav1"
location = "swedencentral"

openai_location = "swedencentral"

// Replace with the subscription id printed by bootstrap.sh.
subscription_id = "62fc369a-68ad-4db3-89fb-1d522050ff40"

// Set once the DNS records returned by `terraform output dns_validation`
// have been created at the registrar. Leave empty for the first apply — the
// validation token only exists after the custom domain resource is created.
// Voir la note cote dev : un domaine vide fait rejeter l'Ingress, le champ
// doit rester renseigne meme avant la bascule DNS.
custom_domain = "sivax.health"

// Front Door : quota de profils à 0 sur cet abonnement, relevable uniquement
// par demande de support. prod sert donc directement depuis l'IP publique de
// l'ingress, comme dev — le NSG s'ouvre automatiquement sur 80/443 quand cette
// valeur est fausse.
enable_frontdoor = false

// Terraform écrit les secrets depuis l'extérieur du VNet ; sans cette liste le
// module bascule le coffre en default_action = Allow, c'est-à-dire ouvert.
//
key_vault_allowed_ips = ["86.68.140.248"]

acme_email = ""

alert_emails = []

dhis2_base_url = "https://snisrdc.com"
dhis2_username = "Berly_Lora"
dhis2_root_ou  = "ymGeqzoPhN3"

// Prod réutilise le MÊME projet Supabase que dev (décision assumée : pas
// d'isolation dev/prod sur cette base). Sans cette URL, l'ETL plantait
// (`supabase_url is required`) et la couche données Supabase de prod était
// non fonctionnelle — l'agent ne trouvait aucun indicateur. Les clés
// correspondantes (service_role_key, anon_key) doivent pointer sur CE projet,
// fournies en TF_VAR_* par la CI (variable group diav1-prod = valeurs de dev).
supabase_url = "https://xqhiynjuyxtvptayrrjk.supabase.co"

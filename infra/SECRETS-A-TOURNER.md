# Secrets à tourner

Les identifiants de l'ancien déploiement SIVAX ont été fournis en clair dans
deux fichiers déposés sous `infra/` :

- `infra/SIVAX — Environment Configuration.txt`
- `infra/azure-configs.txt`

Ces deux fichiers sont désormais couverts par `.gitignore` (`infra/*.txt`) et
**ne sont jamais entrés dans l'historique git** — vérifié avec
`git log --all -- 'infra/*.txt'`, zéro occurrence. Le risque n'est donc pas une
fuite par le dépôt, mais le fait que ces valeurs ont circulé en clair.

## À tourner en priorité

| Secret | Pourquoi | Où le régénérer |
|--------|----------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Contourne toute la RLS : accès complet en lecture et écriture à la base | Supabase → Settings → API → Rotate |
| Secret client du service principal `terraform-sp` | Donne Contributor + User Access Administrator sur l'abonnement | Portail Entra → App registrations → Certificates & secrets |
| `DHIS2_PASSWORD` (compte `Berly_Lora`) | Accès au SNIS RDC — compte nominatif d'un tiers | Auprès de l'administrateur SNIS |
| `OPENAI_API_KEY` | Facturable à l'usage, sans plafond par défaut | platform.openai.com → API keys |
| `RESEND_API_KEY` | Permet d'envoyer des e-mails au nom du domaine | resend.com → API keys |
| `ELEVENLABS_API_KEY` | Facturable à l'usage | elevenlabs.io → Profile → API key |
| `SUPABASE_JWT_SECRET` | Permet de forger des jetons de session valides | Supabase → Settings → API |
| `VAPID_PRIVATE_KEY` | Permet d'émettre des notifications push au nom de l'application | `npx web-push generate-vapid-keys` |
| Clé API Hostinger | Contrôle DNS et hébergement de l'ancien site | Panneau Hostinger |

## `PUSH_INTERNAL_TOKEN` — cas particulier

Le fichier SIVAX contient `PUSH_INTERNAL_TOKEN=diav1-internal-push-2024`.

C'est exactement la valeur de repli **publiée dans le dépôt** relevée par
l'audit sous la référence SEC-02, qui ouvre l'envoi de notifications push et
d'e-mails à tous les utilisateurs. Elle est présente dans l'historique git.

Terraform en génère désormais une nouvelle (`random_password`) et la dépose en
Key Vault, et le code n'accepte plus de valeur de repli. **Mais générer la
nouvelle ne révoque pas l'ancienne** : tant que l'ancien déploiement SIVAX
tourne avec cette valeur, elle reste valable chez lui.

## Après rotation

Les valeurs ne se remettent pas à la main dans Azure. Elles sont saisies une
fois en **GitHub Environment Secrets** et poussées en Key Vault par Terraform
(voir `infra/bootstrap/README.md` pour la liste des noms attendus). Un
`terraform apply` suffit ensuite à propager la nouvelle valeur ; les
`SecretProviderClass` la remontent dans les pods dans les 5 minutes grâce à la
rotation activée sur le driver CSI.

Trois secrets n'ont pas à être tournés à la main parce que Terraform les
génère et que personne n'a besoin de les connaître : le mot de passe
administrateur PostgreSQL, `PUSH_INTERNAL_TOKEN` et
`APP_SETTINGS_ENCRYPTION_KEY`.

# Évaluation des coûts d'infrastructure

**Version du 9 septembre 2026.** Ce document chiffre le coût de fonctionnement
de la plateforme SIVAX sur Amazon Web Services. Il remplace l'évaluation établie
pour la précédente infrastructure Azure, qui n'a plus d'objet depuis la bascule
du 8 septembre 2026.

## Méthode

Deux précautions distinguent ces chiffres d'une estimation faite au catalogue :

- **L'inventaire vient du compte**, non du code. Chaque ressource a été relevée
  par interrogation directe de l'API AWS sur les deux régions. Ce qui est
  chiffré est donc ce qui tourne réellement — y compris ce que personne n'avait
  demandé, et qui était facturé quand même.
- **Les prix viennent de l'API de facturation d'AWS**, région par région.
  Paris et Francfort ne sont pas au même tarif, et l'écart se voit sur les
  postes lourds.

Base de calcul : 730 heures par mois, tarif à la demande, sans engagement de
durée. Montants exprimés en dollars américains, devise de facturation d'AWS.

## Synthèse

| Environnement | Région | USD par mois |
|---|---|---|
| Développement | eu-west-3 (Paris) | 233 |
| Production | eu-central-1 (Francfort) | 474 |
| **Total** | | **707** |

Ces montants couvrent la capacité provisionnée. Ils excluent les coûts liés au
volume de trafic, détaillés plus loin, ainsi que les services facturés hors AWS
— l'API du fournisseur de modèles de langage au premier chef.

À titre de comparaison, l'enveloppe visée sur l'infrastructure Azure précédente
était d'environ 800 dollars par mois pour les deux environnements. La bascule
n'alourdit donc pas la dépense ; elle ne l'allège pas non plus de façon
significative, et les marges de réduction identifiées tiennent au
dimensionnement plutôt qu'au choix du fournisseur.

## Développement — eu-west-3 (Paris)

| Poste | Base de calcul | USD par mois |
|---|---|---|
| Plan de contrôle Kubernetes | 0,100 × 730 | 73,00 |
| Nœuds — 2 × t3a.medium | 2 × 0,0425 × 730 | 62,05 |
| Disques des nœuds — 80 Go | 80 × 0,0928 | 7,42 |
| Base de données — db.t4g.micro | 0,018 × 730 | 13,14 |
| Stockage de la base — 20 Go | 20 × 0,133 | 2,66 |
| Passerelle NAT | 0,050 × 730 | 36,50 |
| Load balancer applicatif | 0,02646 × 730 | 19,32 |
| Adresses IPv4 publiques — 3 | 3 × 0,005 × 730 | 10,95 |
| Secrets — 10 | 10 × 0,40 | 4,00 |
| Registre d'images — 0,35 Go | 0,35 × 0,10 | 0,04 |
| Journaux | estimation | 3,00 |
| Stockage objet | estimation | 0,50 |
| **Total** | | **232,58** |

## Production — eu-central-1 (Francfort)

| Poste | Base de calcul | USD par mois |
|---|---|---|
| Plan de contrôle Kubernetes | 0,100 × 730 | 73,00 |
| Nœuds système — 2 × t3a.medium | 2 × 0,0432 × 730 | 63,07 |
| Nœuds applicatifs — 2 × t3a.large | 2 × 0,0864 × 730 | 126,14 |
| Disques des nœuds — 160 Go | 160 × 0,0952 | 15,23 |
| Base de données — db.t4g.small | 0,037 × 730 | 27,01 |
| Stockage de la base — 50 Go | 50 × 0,137 | 6,85 |
| Passerelles NAT — 3 | 3 × 0,052 × 730 | 113,88 |
| Load balancer applicatif | 0,027 × 730 | 19,71 |
| Adresses IPv4 publiques — 6 | 6 × 0,005 × 730 | 21,90 |
| Secrets — 10 | 10 × 0,40 | 4,00 |
| Registre d'images — 0,35 Go | 0,35 × 0,10 | 0,04 |
| Journaux | estimation | 3,00 |
| Stockage objet | estimation | 0,50 |
| **Total** | | **474,33** |

## Ce qui varie avec l'usage

Ces postes dépendent du trafic réel et non de la capacité réservée. Ils
s'ajoutent aux montants ci-dessus, dans des proportions modestes au volume
actuel.

| Poste | Tarif | Facteur déterminant |
|---|---|---|
| Données traitées par les passerelles NAT | 0,050 à 0,052 USD par Go | la synchronisation quotidienne SNIS RDC |
| Capacité du load balancer | environ 0,008 USD par unité-heure | nombre de connexions simultanées |
| Transfert sortant vers Internet | 0,09 USD par Go au-delà de 100 Go | poids des pages servies |
| Ingestion des journaux | 0,50 USD par Go | niveau de journalisation retenu |

## Ce qui ne génère aucun coût

- **La chaîne de livraison.** Elle s'exécute sur GitHub Actions, dont le forfait
  gratuit couvre 2 000 minutes par mois pour un dépôt privé. Un déploiement
  complet en consomme environ six, soit près de trois cents déploiements
  mensuels compris dans le forfait.
- **Le service de construction d'images d'AWS**, provisionné mais inactif : le
  compte n'autorise pas encore son exécution. Le jour où cette limite sera
  levée, compter quelques centimes par déploiement.
- **L'agent de déploiement continu** et la construction d'images dans le
  cluster, qui s'exécutent sur des machines déjà facturées.
- **La gestion du nom de domaine**, restée chez l'hébergeur actuel.

## Optimisation réalisée

Cinq adresses IPv4 publiques étaient facturées sans être rattachées à aucune
ressource — deux en développement, trois en production — pour **18,25 dollars
par mois**. Il s'agissait d'adresses réservées pour une variante d'architecture
finalement écartée, le compte AWS n'autorisant pas le type de load balancer
correspondant. AWS facturant toute adresse IPv4 publique depuis février 2024,
qu'elle serve ou non, une adresse inutilisée coûtait exactement autant qu'une
adresse en service.

Ces adresses ont été libérées, et le bon fonctionnement des deux environnements
vérifié après l'opération. Les montants du présent document en tiennent compte ;
ils s'élevaient à 725 dollars avant cette correction.

Un audit du compte a été mené dans la même passe, à la recherche d'autres postes
facturés sans contrepartie : volumes de stockage détachés, load balancers
résiduels, sauvegardes manuelles oubliées, images de conteneurs orphelines.
Aucun n'a été trouvé. **Tout ce qui reste facturé sert.**

## Marges de réduction identifiées

Les deux pistes ci-dessous ne relèvent pas du nettoyage : chacune échange de la
dépense contre de la résilience. Elles appellent donc une décision, non une
application automatique.

### Dimensionnement des nœuds applicatifs — jusqu'à 133 USD par mois

Les applications de production réservent au total 610 millicœurs, sur 8 cœurs
provisionnés. Le groupe de nœuds applicatifs représente 126 dollars de calcul et
8 dollars de disque par mois.

Deux options, de portée différente : ramener ces nœuds à la taille employée en
développement économise environ 63 dollars par mois tout en conservant la
séparation entre applications et modules du cluster ; supprimer entièrement le
groupe économise 133 dollars, au prix de cette séparation.

L'une comme l'autre suppose un remplacement des nœuds, donc une brève
interruption à programmer.

### Passerelles NAT de production — 75,92 USD par mois

La production dispose d'une passerelle par zone de disponibilité. Deux d'entre
elles pourraient être supprimées. Ce n'est pas du gaspillage : cette redondance
garantit qu'une panne affectant une zone ne prive pas les deux autres de leur
accès à Internet — donc à SNIS RDC. La question est de savoir si ce niveau de
disponibilité est requis au regard des usages.

Les deux mesures cumulées ramèneraient la dépense mensuelle d'environ 707 à
**500 dollars**.

## Suivi budgétaire : à activer

Quatre alarmes techniques sont configurées par environnement, et un budget de
dépense mensuel est prévu dans la configuration — 250 dollars en développement,
500 en production.

**Ni les unes ni l'autre ne préviennent actuellement qui que ce soit.** Le canal
de notification ne compte aucun destinataire, et le budget n'est de ce fait pas
créé. Renseigner une ou plusieurs adresses de courriel dans la configuration
active les deux d'un seul geste.

Deux remarques sur les seuils, une fois cette activation faite. Les montants
prévus, 250 et 500 dollars, sont très proches de la dépense réelle : le seuil
d'alerte à 80 % serait franchi dès le premier mois complet. L'ordre à suivre
est donc d'appliquer d'abord les réductions retenues, puis d'ajuster les
budgets à la dépense qui subsiste — relever les seuils sans toucher aux
dépenses reviendrait à faire taire l'instrument plutôt qu'à traiter ce qu'il
mesure.

## Périmètre non couvert

- **L'API du fournisseur de modèles de langage**, facturée à l'usage
  indépendamment d'AWS. C'est le poste susceptible de croître sans
  qu'aucune capacité n'ait été réservée, puisqu'il suit le nombre de questions
  posées à l'assistant.
- **La plateforme Supabase**, sur son propre abonnement.
- **L'hébergement du domaine**, qui porte le service de noms, la messagerie et
  la redirection du nom racine.

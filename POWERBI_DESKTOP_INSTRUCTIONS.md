# POWER BI RDC — Instructions Power BI Desktop

## Modèle sémantique + rapport Power BI + Power BI Embedded + Agent IA

---

# 0. Objectif du document

Ce document constitue la spécification technique pour construire le premier
vertical slice Power BI RDC.

L'objectif est de construire un rapport Power BI alimenté par les données
DHIS2 RDC déjà intégrées dans Supabase, puis de publier ce rapport dans
Power BI Service / Microsoft Fabric afin de l'intégrer dans la plateforme
Next.js via Power BI Embedded.

Le rapport doit également être conçu dès le départ pour être pilotable par
l'agent IA de la plateforme.

Le premier livrable est volontairement limité à une seule page fonctionnelle :

> **Couverture vaccinale**

Cette page constitue le vertical slice de validation de toute l'architecture.

Ne pas construire immédiatement les 9 pages. Les 8 autres pages seront
ajoutées uniquement après validation complète du vertical slice.

---

# 1. Architecture cible

Architecture générale :

```
DHIS2
    ↓
ETL existant
    ↓
Supabase PostgreSQL
    ↓
Power BI Desktop
    ↓
Modèle sémantique Power BI
    ↓
Rapport .PBIX
    ↓
Power BI Service / Microsoft Fabric
    ↓
Power BI Embedded
    ↓
Application Next.js
    ↓
Agent IA
```

Architecture détaillée de l'agent IA :

```
                         ┌──────────────────────────┐
                         │        AGENT IA          │
                         │    langage naturel       │
                         └────────────┬─────────────┘
                                      │
                     ┌────────────────┴────────────────┐
                     │                                 │
                     ▼                                 ▼
             ANALYSE DES DONNÉES                 PILOTAGE UI
                     │                                 │
                     ▼                                 ▼
            REST API (DAX)                       JS SDK
                     │                                 │
                     ▼                                 ▼
          Semantic Model Power BI             Embedded Report
                     │                                 │
                     └────────────────┬────────────────┘
                                      ▼
                              EXPÉRIENCE UTILISATEUR
```

PRINCIPE FONDAMENTAL :

- Le serveur Next.js sert à comprendre et interroger les données via les
  API REST Power BI (`executeQueries`, `getModel`).
- Le JS SDK (`powerbi-client`) sert à piloter le rapport affiché dans le
  navigateur (pages, filtres, bookmarks).
- Le LLM ne doit jamais manipuler directement les credentials Power BI.
- Le navigateur ne doit jamais recevoir le client secret Entra ID.
- Le runtime IA doit être en lecture seule côté modèle sémantique.

---

# 2. Objectifs du MVP

Le premier vertical slice doit permettre :

1. Connexion Power BI à Supabase.
2. Création d'un modèle sémantique propre.
3. Création des mesures DAX principales.
4. Création d'une page « Couverture vaccinale ».
5. Création de slicers géographiques et temporels.
6. Création de KPI.
7. Création d'une évolution temporelle.
8. Création d'un classement des provinces.
9. Création d'une carte RDC.
10. Création d'un tableau par zone de santé.
11. Création de bookmarks stables.
12. Publication dans Power BI Service.
13. Configuration du refresh.
14. Récupération des IDs Power BI.
15. Intégration via Power BI Embedded.
16. Pilotage du rapport via JS SDK.
17. Interrogation du modèle via DAX (REST API).
18. Validation de deux scénarios IA :

    « Affiche la couverture Penta3 à Kinshasa en 2025 »

    et

    « Montre les zones de santé sous 80 % de couverture »

---

# 3. Règle importante : ne pas construire les 9 pages immédiatement

Le rapport final comportera 9 pages :

1. Vue d'ensemble / Executive
2. Couverture vaccinale
3. Performance & Équité
4. Chaîne d'approvisionnement & Stock
5. Chaîne du froid & Équipements
6. Pertes, Consommation & Déchets
7. Qualité des données
8. Gestion PEV & Supervision
9. Surveillance MPV

Mais le MVP doit uniquement construire :

> Page 2 — Couverture vaccinale

La validation de cette page permettra de valider :

- modèle ; données ; DAX ; Power BI ; publication ; Embedded ;
- JS SDK ; agent IA ; DAX (REST) ; UX.

---

# 4. Prérequis Supabase

Le modèle source doit contenir au minimum :

- `dim_org_units`
- `dim_indicators`
- `fact_indicator_values`
- `dim_date`

Les éléments existants du modèle sont conservés.

La vue `v_fact_indicator_values_dated` peut être conservée comme outil de
diagnostic ou alternative, mais le modèle principal doit privilégier le
schéma en étoile.

---

# 5. Compte de connexion Power BI à Supabase

NE PAS utiliser le compte PostgreSQL administrateur `postgres` pour Power BI
en production.

Créer un utilisateur PostgreSQL dédié :

```
powerbi_readonly
```

Ce compte doit disposer uniquement des droits SELECT nécessaires.

Objectifs :

- séparation des privilèges ;
- meilleure sécurité ;
- meilleure traçabilité ;
- possibilité de révoquer Power BI indépendamment ;
- réduction du risque de fuite de credentials.

---

# 6. Couche SQL dédiée à Power BI

Lorsque cela est possible, créer des vues dédiées :

```
vw_powerbi_indicator_values
vw_powerbi_indicators
vw_powerbi_org_units
```

Ne pas exposer inutilement les tables internes de l'application.
La couche Power BI doit fournir uniquement les données nécessaires à l'analyse.

---

# 7. Modèle de données cible

Le modèle Power BI doit être un modèle en étoile.

```
                     dim_date
                        │
                        │ 1
                        │
                        ▼ *
dim_indicators ─── fact_indicator_values ─── dim_org_units
```

Relations :

```
fact_indicator_values[indicator_id]  →  dim_indicators[id]
fact_indicator_values[org_unit_id]   →  dim_org_units[id]
fact_indicator_values[date]          →  dim_date[date]
```

Cardinalité : Fact → Dimension = Many-to-One
Direction du filtre : Single

Les relations bidirectionnelles doivent être évitées sauf nécessité démontrée.

---

# 8. Dimension temporelle

Créer/utiliser : `dim_date`

Champs recommandés :

```
date
year
month_number
month_name
year_month
year_quarter
quarter_number
```

Exemple :

```
2025-01-01  →  2025  →  1  →  Janvier  →  202501  →  2025-Q1  →  1
```

La relation principale doit idéalement être :

```
fact_indicator_values[date]  →  dim_date[date]
```

Si la fact ne contient actuellement que YYYYMM, créer dans Power Query ou
Supabase une colonne date correspondant au premier jour du mois.
Ne pas utiliser YYYYMM comme unique mécanisme d'intelligence temporelle.

---

# 9. Dimension géographique

La dimension `dim_org_units` doit permettre de représenter :

```
RDC
  ↓
Province
  ↓
Zone de santé
  ↓
Organisation Unit
```

Champs recommandés :

```
id
name
level
province_id
province_name
zone_id
zone_name
parent_id
path
```

Créer la hiérarchie :

```
Géographie
    Province
    Zone de santé
    Organisation unit
```

IMPORTANT : Ne pas utiliser les noms comme clés techniques.
Utiliser `province_id`, `zone_id`, `org_unit_id`.
Les noms servent uniquement à l'affichage.

---

# 10. Dimension indicateurs

La table `dim_indicators` est fondamentale pour l'agent IA.
Elle doit contenir au minimum :

```
id
source
code
label
short_label
unit
category
icon_key
```

Ajouter/recommander :

```
antigen
dose
pev_domain
description
numerator_indicator_id
denominator_indicator_id
target
threshold_critical
threshold_warning
threshold_target
```

Exemple conceptuel :

```
code              = PENTA3_COVERAGE
label             = Couverture Penta3
antigen           = Penta
dose              = 3
unit              = %
pev_domain        = Coverage
threshold_critical = 60
threshold_warning  = 80
threshold_target   = 90
```

Cette structure permet à l'agent IA de comprendre que « Penta3 » correspond
à `antigen = Penta` et `dose = 3`.

Ne pas coder uniquement `antigen = Penta` car cela ne distingue pas
Penta1, Penta2 et Penta3.

---

# 11. Validation critique de la colonne value

Avant de créer les mesures DAX, déterminer exactement ce que représente :

```
fact_indicator_values[value]
```

Il faut déterminer si chaque ligne représente :

A. un pourcentage déjà calculé ;
B. un numérateur ;
C. un dénominateur ;
D. une quantité brute ;
E. plusieurs types selon l'indicateur.

NE PAS appliquer automatiquement `AVERAGE(value)` à tous les indicateurs.

Pour chaque indicateur, documenter `value_type` :

```
ratio | count | numerator | denominator | stock | percentage
```

- Si l'indicateur est déjà un ratio : `AVERAGE(value)` peut être acceptable
  selon la granularité.
- Si l'indicateur est un nombre : `SUM(value)` peut être approprié.
- Si l'indicateur est calculé à partir d'un numérateur et dénominateur :
  `SUM(numerator) / SUM(denominator)` doit être privilégié.

IMPORTANT : Le calcul métier doit être validé avant la création définitive
des mesures.

---

# 12. Connexion Power BI Desktop

```
Accueil  →  Obtenir les données  →  PostgreSQL
```

Serveur : `db.<SUPABASE_PROJECT_REF>.supabase.co`
Base : `postgres`

Mode recommandé pour le MVP : `Import`

Utilisateur : `powerbi_readonly`

Ne jamais mettre les credentials administrateur dans le projet.

---

# 13. Tables à importer

Importer :

```
dim_date
dim_indicators
dim_org_units
fact_indicator_values
```

Ne pas importer inutilement toutes les tables Supabase.

La vue `v_fact_indicator_values_dated` peut être utilisée comme alternative
de diagnostic, mais ne doit pas conduire à dupliquer les données dans le
modèle final.

---

# 14. Power Query

Dans Power Query :

1. Vérifier les types.
2. Supprimer les colonnes inutiles.
3. Vérifier les valeurs nulles.
4. Vérifier les doublons.
5. Vérifier les identifiants.
6. Vérifier les périodes.
7. Vérifier les valeurs aberrantes.
8. Vérifier les unités.

Pour `value` le type doit être numérique. Pour les dates : `Date`.

---

# 15. Tests de qualité avant le modèle

Avant de créer les visualisations, créer des contrôles temporaires :

```DAX
Nombre de lignes      = COUNTROWS(fact_indicator_values)
Nombre de provinces   = DISTINCTCOUNT(dim_org_units[province_id])
Nombre de zones       = DISTINCTCOUNT(dim_org_units[zone_id])
Nombre d'indicateurs  = DISTINCTCOUNT(dim_indicators[id])
Première période      = MIN(dim_date[date])
Dernière période      = MAX(dim_date[date])
```

Vérifier que les résultats correspondent aux données Supabase.

---

# 16. Mesures DAX — Principes

Les mesures doivent être organisées par catégories.

Ne pas créer de mesure générique `SELECTEDMEASURE()`.
Cette fonction n'est pas nécessaire ici et doit être supprimée des mesures
ordinaires. Les calculation groups constituent un sujet séparé et ne sont
pas nécessaires pour le MVP.

---

# 17. Mesures DAX — Base

```DAX
Valeur totale =
SUM ( fact_indicator_values[value] )

Nombre de provinces =
DISTINCTCOUNT ( dim_org_units[province_id] )

Nombre de zones de santé =
DISTINCTCOUNT ( dim_org_units[zone_id] )

Dernière période =
MAX ( dim_date[date] )
```

---

# 18. Mesures DAX — Couverture

Les IDs ci-dessous proviennent du modèle source fourni et doivent être
vérifiés dans Supabase avant utilisation définitive.

```DAX
Couverture Penta3 % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "v9b9aYsA5PM"
)

Couverture Penta1 % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "k26tJ22Ncpd"
)

Couverture BCG % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "cWJXYKCXrLx"
)

Couverture VAP4 % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "tNZxs1kE6fy"
)
```

IMPORTANT : Ces mesures sont des exemples du modèle source.
Avant validation, vérifier que ces indicateurs contiennent réellement des
taux de couverture et que leur granularité permet une moyenne correcte.

---

# 19. Mesures DAX — Dropout

```DAX
Abandon Penta1-Penta3 % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "MULXtL8iom8"
)

Abandon MR1-MR2 % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "FhQ8Hd5rCHj"
)
```

Même règle : valider la sémantique de `value` avant validation finale.

---

# 20. Mesures DAX — Pertes

```DAX
Taux de perte vaccins % =
CALCULATE (
    AVERAGE ( fact_indicator_values[value] ),
    dim_indicators[id] = "YM7Tmn01ieL"
)
```

Ce KPI sera affiché dans le MVP uniquement pour fournir un aperçu.
Il sera principalement utilisé dans la page future
« Pertes, Consommation & Déchets ».

---

# 21. Mesures DAX — Doses

```DAX
BCG - Doses administrées =
CALCULATE (
    SUM ( fact_indicator_values[value] ),
    dim_indicators[id] = "W25tOXS0rxS"
)

Penta1 - Doses administrées =
CALCULATE (
    SUM ( fact_indicator_values[value] ),
    dim_indicators[id] = "uNdFg1eymsa"
)

Penta3 - Doses administrées =
CALCULATE (
    SUM ( fact_indicator_values[value] ),
    dim_indicators[id] = "WWxqaHSeiwd"
)
```

Vérifier les IDs avant validation.

---

# 22. Mesure de complétude — Ne pas utiliser l'ancienne formule

NE PAS utiliser `26 * 12` contre `DISTINCTCOUNT(org_unit_id)`.
Ces deux quantités ne mesurent pas la même chose.

La complétude doit être :

```
observations reçues / observations attendues
```

La granularité attendue doit être définie métier.

Exemple :

```
organisation units attendues × indicateurs attendus × périodes attendues
```

Créer une mesure uniquement après avoir déterminé cette granularité.

Conceptuellement :

```DAX
Complétude % =
DIVIDE (
    [Observations reçues],
    [Observations attendues],
    0
)

Observations reçues =
COUNTROWS ( fact_indicator_values )
```

Puis définir précisément `Observations attendues` en fonction du périmètre
DHIS2 réel.

---

# 23. Hiérarchie temporelle

Créer :

```
Temps
    Année
    Trimestre
    Mois
```

Utiliser `month_number` pour trier `month_name`.
Ne jamais laisser Power BI trier les mois alphabétiquement.

---

# 24. Format des mesures

| Mesure             | Format        | Décimales |
| ------------------ | ------------- | --------: |
| Couverture X %     | Pourcentage   |         1 |
| Abandon X %        | Pourcentage   |         1 |
| Taux de perte %    | Pourcentage   |         1 |
| Doses administrées | Nombre entier |         0 |
| Complétude %       | Pourcentage   |         0 |

---

# 25. Seuils métier

Les valeurs métier doivent idéalement être stockées dans `dim_indicators` :

```
threshold_critical
threshold_warning
threshold_target
```

Pour le MVP, utiliser les seuils fournis dans le modèle source :

| Indicateur            | Critique | Alerte  | Cible |
| --------------------- | -------: | ------: | ----: |
| Couverture Penta3     |    < 60% | 60–80%  |  ≥ 90% |
| Couverture BCG        |    < 70% | 70–85%  |  ≥ 95% |
| Abandon Penta1-Penta3 |    > 15% | 10–15%  |   ≤ 5% |
| Taux de perte         |    > 25% | 15–25%  |   ≤ 5% |

IMPORTANT : Ces seuils doivent être considérés comme des paramètres métier
à valider, pas comme des constantes techniques définitives.

---

# 26. Page MVP — Couverture vaccinale

Créer une page nommée :

```
Couverture vaccinale
```

Le nom doit rester stable. Le runtime IA doit pouvoir identifier cette page
dynamiquement via `report.getPages()`. Ne pas faire dépendre l'agent
uniquement d'une chaîne codée en dur.

---

# 27. Slicers

Placer en haut :

| Slicer        | Table          | Champ         |
| ------------- | -------------- | ------------- |
| Province      | dim_org_units  | province_name |
| Zone de santé | dim_org_units  | zone_name     |
| Antigène      | dim_indicators | antigen       |
| Année         | dim_date       | year          |
| Mois          | dim_date       | month_name    |

Ajouter éventuellement `Dose` si cette colonne est disponible et nécessaire.

---

# 28. KPI Cards

Créer :

1. Couverture Penta3
2. Couverture Penta1
3. Abandon Penta1-Penta3
4. Zéro-dose si disponible

Le taux de perte peut être affiché comme cinquième KPI ou dans une zone
secondaire. Ne pas mélanger excessivement des domaines métier différents
dans la ligne principale.

---

# 29. Courbe mensuelle

Type : `Line chart`

| Axe | Champ |
| --- | --- |
| X | `dim_date[year_month]` |
| Y | `[Couverture Penta3 %]` |
| Légende (optionnelle) | `dim_org_units[province_name]` |

Titre : « Évolution de la couverture Penta3 »
Axe Y : 0 à 100 % (fixe)

Le champ `year_month` doit être trié chronologiquement.

---

# 30. Bar chart par province

Type : `Bar chart horizontal`

| Axe | Champ |
| --- | --- |
| Y | `dim_org_units[province_name]` |
| X | `[Couverture Penta3 %]` |

Tri : décroissant. Afficher : data labels.
La couleur doit être conditionnelle selon les seuils métier.

---

# 31. Carte RDC

Objectif : Afficher la couverture Penta3 par province.

Priorité :

1. carte géographique fiable ;
2. couche géographique RDC ;
3. fallback carte Power BI.

Ne pas utiliser les noms comme unique clé géographique.
Préparer si nécessaire un fichier géographique avec `province_id` et la
géométrie correspondante. Le GeoJSON doit être validé avant son utilisation
en production.

La carte ne doit pas être considérée comme validée tant que les 26
provinces ne sont pas correctement reconnues.

> Note : Pour une carte choroplèthe précise de la RDC, importer le GeoJSON
> des provinces dans Power BI (Shape Map visual). Le fichier GeoJSON des
> 26 provinces de la RDC peut être trouvé sur https://data.humdata.org
> (search « DRC provinces geojson »).

---

# 32. Tableau par zone de santé

Créer une table contenant :

```
Province | Zone de santé | Couverture Penta3 | Couverture BCG | Abandon | Période
```

Tri : `Couverture Penta3` croissante (les plus faibles en haut).

Objectif : Afficher immédiatement les zones de santé les plus faibles.
Cette table est fondamentale pour le futur agent IA.

---

# 33. Bookmarks — Conception pour l'IA

Créer :

```
bm_couverture_penta3
bm_couverture_bcg
bm_vue_nationale
```

Chaque bookmark doit être testé avec le JS SDK.
Le bookmark `bm_couverture_penta3` doit correspondre à une vue clairement
définie. Le bookmark `bm_vue_nationale` doit correspondre à une vue
nationale sans filtre utilisateur résiduel.

IMPORTANT : Ne pas appliquer aveuglément la règle « décocher Data ».
Le comportement des bookmarks doit être défini en fonction de ce qu'ils
doivent restaurer :

- état visuel ;
- page ;
- filtres ;
- slicers ;
- sélection.

Si le bookmark doit restaurer des filtres, il doit capturer l'état
nécessaire. Tester ensuite le comportement avec `bookmarksManager.apply()`.

---

# 34. Convention des bookmarks

Tous les bookmarks IA doivent commencer par `bm_` :

```
bm_couverture_penta3
bm_couverture_bcg
bm_vue_nationale
bm_ruptures_zs
bm_score_composite
```

Le nom technique doit rester stable.

---

# 35. Boutons de navigation

Optionnel. Créer :

```
Penta3 | BCG | Vue nationale
```

Chaque bouton peut appliquer le bookmark correspondant.
Ces boutons sont uniquement UX. L'agent IA ne doit pas dépendre de ces
boutons.

---

# 36. Paramètres Power BI

Configurer :

```
Région : français
Format date : dd/mm/yyyy
Séparateur milliers : espace
```

Le modèle doit utiliser des conventions cohérentes avec l'interface
francophone.

---

# 37. Tests locaux du rapport

Avant publication, effectuer les tests suivants.

| Test | Sélection | Résultat attendu |
| --- | --- | --- |
| 1 | Province = Kinshasa | tous les visuels filtrés sur Kinshasa |
| 2 | Année = 2025 | données temporelles uniquement 2025 |
| 3 | Antigène = Penta | mesure Penta3 correspond à dose 3 |
| 4 | Province=Kinshasa + Année=2025 + Antigène=Penta | valeur vérifiée manuellement |
| 5 | Aucune sélection | vue nationale correcte |

---

# 38. Contrôle de cohérence DAX

Pour au moins trois provinces (Kinshasa, Nord-Kivu, Haut-Katanga),
comparer :

```
Power BI  vs  Supabase  vs  calcul manuel
```

Les valeurs doivent être cohérentes.
Ne pas publier tant que les écarts ne sont pas expliqués.

---

# 39. Sauvegarde

Nom du fichier : `PEV_RDC_Analytics.pbix`
Conserver dans : `/powerbi/PEV_RDC_Analytics.pbix`

Le fichier PBIX n'a pas besoin d'être versionné dans Git si sa taille
devient importante. Versionner plutôt :

- documentation ; scripts SQL ; configuration ; modèle ;
- DAX documenté ; spécification des pages ; dictionnaire des indicateurs.

---

# 40. Publication Power BI Service

```
Accueil  →  Publier  →  Workspace : PEV RDC Analytics
```

Après publication, vérifier :

```
Report
Semantic Model
```

Le terme « Dataset » peut encore apparaître dans certaines interfaces/API.
Dans la documentation interne, utiliser de préférence `Semantic Model`.

---

# 41. Workspace Power BI / Fabric

Créer ou utiliser le workspace `PEV RDC Analytics`.
Le workspace doit être celui utilisé par l'application Embedded.

Conserver les IDs :

```
Workspace ID
Report ID
Semantic Model ID
```

---

# 42. Refresh

Configurer les credentials de la source Supabase dans Power BI Service.
Puis configurer `Scheduled refresh`.

Le refresh doit être cohérent avec l'ETL DHIS2 :

```
DHIS2  →  ETL 05:00  →  Supabase  →  Power BI refresh 05:30
```

Ne pas faire tourner Power BI avant que l'ETL ait terminé.

---

# 43. Test du refresh

```
Refresh now  →  Refresh history  →  Résultat attendu : Success
```

Si le refresh échoue : vérifier credentials, réseau, droits, schéma,
colonnes, changements Supabase.

---

# 44. Power BI Embedded

Architecture :

```
Microsoft Entra ID
      ↓
App Registration
      ↓
Service Principal
      ↓
Power BI Workspace
      ↓
Embed Token
      ↓
Next.js
      ↓
powerbi-client
      ↓
Embedded Report
```

Le client secret ne doit jamais être envoyé au navigateur.

---

# 45. Variables d'environnement

Backend uniquement :

```env
POWERBI_TENANT_ID=
POWERBI_CLIENT_ID=
POWERBI_CLIENT_SECRET=
POWERBI_WORKSPACE_ID=
POWERBI_REPORT_ID=
POWERBI_DATASET_ID=
```

Ne jamais exposer `POWERBI_CLIENT_SECRET` dans `NEXT_PUBLIC_*` ou dans le
code client.

---

# 46. Embed Token

Le backend doit :

1. authentifier l'application auprès d'Entra ID ;
2. obtenir un access token ;
3. appeler les API Power BI nécessaires ;
4. générer l'Embed Token ;
5. transmettre au frontend uniquement les informations nécessaires à l'embed.

Le frontend reçoit :

```
embedToken | reportId | embedUrl | permissions/configuration
```

Il ne reçoit jamais : `client_secret`.

---

# 47. Remplacer l'iframe

Le rapport ne doit plus être intégré avec `<iframe>`.
Utiliser le JS SDK Power BI (`powerbi-client`).

Le composant `PowerBIContainer` est le point central de l'intégration.

---

# 48. PowerBI Container

Le composant doit gérer :

```
embed | loaded | rendered | error | pages | bookmarks | filters | navigation | fullscreen
```

Conserver une référence `report` (ex. `reportRef.current`).
Cette référence sera utilisée par les commandes IA côté navigateur.

---

# 49. Découverte dynamique des pages

Au chargement :

```
report.getPages()
```

Récupérer : `page name`, `page displayName`, `visibility`.

Construire un contexte :

```json
{
  "pages": [
    { "name": "...", "displayName": "Couverture vaccinale" }
  ]
}
```

Ne pas demander au LLM de deviner les pages disponibles.

---

# 50. Découverte dynamique des bookmarks

Lorsque l'API disponible et la configuration du rapport le permettent :

```
bookmarksManager.getBookmarks()
```

Construire :

```json
{
  "bookmarks": ["bm_couverture_penta3", "bm_couverture_bcg", "bm_vue_nationale"]
}
```

Le LLM ne doit jamais inventer un bookmark.

---

# 51. Séparation des outils IA

Les outils doivent être classés en deux familles.

## A. Outils serveur — Analyse (REST API)

```
powerbi_get_model
powerbi_query
```

Ces outils utilisent le modèle sémantique via les API REST Power BI
(`executeQueries`, `getModel`). Les appels sont effectués côté serveur
Next.js, jamais directement depuis le navigateur.

## B. Commandes client — Pilotage (JS SDK)

```
powerbi_apply_filters
powerbi_clear_filters
powerbi_change_page
powerbi_apply_bookmark
powerbi_get_state
powerbi_get_pages
powerbi_get_bookmarks
powerbi_export
```

Cette séparation est obligatoire.

---

# 52. powerbi_get_model

Objectif : Permettre à l'agent de découvrir :

```
tables | colonnes | mesures | relations | hiérarchies | métadonnées
```

Le modèle doit être présenté au LLM sous une forme compacte.

Exemple :

```json
{
  "tables": [
    {
      "name": "dim_indicators",
      "columns": ["id", "code", "label", "antigen", "dose", "pev_domain"]
    }
  ]
}
```

---

# 53. powerbi_query

Objectif : Permettre à l'agent de vérifier une réponse analytique.

Pipeline :

```
utilisateur  →  LLM  →  identification indicateur
  →  identification géographie  →  identification période
  →  DAX  →  Power BI Semantic Model (REST executeQueries)
  →  résultat  →  interprétation
```

---

# 54. Règle de validation des réponses IA

L'agent ne doit pas inventer une valeur.

Pour une question quantitative, l'agent doit :

1. identifier l'indicateur ;
2. identifier le périmètre ;
3. exécuter une requête DAX ;
4. vérifier le résultat ;
5. répondre.

Si aucune donnée n'est disponible :

```
« Les données disponibles ne permettent pas de calculer cette valeur. »
```

Ne pas halluciner.

---

# 55. powerbi_apply_filters

Exemple conceptuel :

```json
{
  "filters": [
    {
      "table": "dim_org_units",
      "column": "province_name",
      "operator": "In",
      "values": ["Kinshasa"]
    },
    {
      "table": "dim_date",
      "column": "year",
      "operator": "In",
      "values": [2025]
    }
  ]
}
```

Cette commande utilise `report.setFilters()` ou l'API de filtre appropriée
selon le niveau de scope.

Tables autorisées pour les filtres : `dim_org_units`, `dim_indicators`,
`dim_date`. Les autres tables sont rejetées par la whitelist.

---

# 56. powerbi_clear_filters

Objectif : Supprimer les filtres appliqués par l'IA.
Doit pouvoir fonctionner aux niveaux `page-level`, `visual-level`,
`report-level` selon le besoin.

---

# 57. powerbi_change_page

Avant d'exécuter : `getPages()`.
Puis rechercher la page correspondant au nom demandé.
Ne jamais naviguer vers une page inexistante.

---

# 58. powerbi_apply_bookmark

Avant exécution : `getBookmarks()`. Puis vérifier que le bookmark existe.

Exemple :

```json
{ "bookmark": "bm_couverture_penta3" }
```

Si le bookmark n'existe pas : retourner une erreur contrôlée.

---

# 59. powerbi_export

Cette commande peut être ajoutée après validation du MVP.
Elle doit respecter les permissions et capacités disponibles dans Power BI.
Ne pas considérer l'export comme une fonctionnalité prioritaire du premier
vertical slice.

---

# 60. Routage du prompt IA

Le système doit distinguer trois types de demandes.

## Type 1 — Analyse

```
« Quelle est la couverture Penta3 à Kinshasa ? »
```

Pipeline : `DAX → résultat → interprétation`

## Type 2 — Pilotage

```
« Affiche Kinshasa en 2025. »
```

Pipeline : `apply_filters → rapport mis à jour`

## Type 3 — Analyse + Pilotage

```
« Affiche la couverture Penta3 à Kinshasa en 2025 et explique-moi le résultat. »
```

Pipeline : `DAX → résultat → apply filters → interprétation`

C'est le comportement prioritaire du MVP.

---

# 61. Exemple end-to-end

Utilisateur :

```
Affiche la couverture Penta3 à Kinshasa en 2025.
```

Étape 1 — LLM identifie :

```
indicator = PENTA3_COVERAGE
province  = Kinshasa
year      = 2025
```

Étape 2 — `powerbi_query` (DAX via REST API)

Étape 3 — Résultat : `72.4 %`

Étape 4 — `powerbi_apply_filters` :

```
Province = Kinshasa
Year = 2025
```

Étape 5 — Afficher et interpréter selon les seuils métier.

---

# 62. Second scénario IA

Utilisateur :

```
Montre les zones de santé sous 80 % de couverture.
```

L'agent doit :

1. identifier Penta3 si le contexte courant est Penta3 ;
2. sinon demander/préciser l'indicateur si nécessaire ;
3. exécuter DAX ;
4. récupérer les zones sous le seuil ;
5. appliquer les filtres nécessaires ;
6. mettre à jour le rapport ;
7. afficher une interprétation.

---

# 63. Panneau IA — Réutiliser l'AssistantDrawer existant

L'interface utilise **le même panneau IA que celui utilisé pour l'analyse
DHIS2** : le composant `AssistantDrawer` (slidebar droite) déjà intégré
dans `AppShell`.

```
src/components/assistant/assistant-drawer.tsx
src/store/assistant-store.tsx
```

**Ne pas créer un composant IA séparé pour Power BI.**

L'agent IA est unique pour toute la plateforme. Il est capable de :

- répondre aux questions analytiques (DHIS2 et Power BI) ;
- piloter le rapport Power BI (filtres, pages, bookmarks) ;
- expliquer les résultats à côté du rapport.

Le rapport Power BI reste visible dans la zone principale pendant que
l'IA applique des filtres. L'utilisateur ouvre le slidebar droit
(`AssistantDrawer`) pour interagir en langage naturel, exactement comme
pour l'analyse DHIS2 in-app.

Le contexte Power BI (page active, filtres actifs, pages disponibles,
bookmarks disponibles) est injecté automatiquement dans le contexte de
l'agent via `powerbiState` (voir `src/store/assistant-store.tsx` et
`src/lib/ai.ts`).

---

# 64. Contrainte UX

L'utilisateur doit pouvoir utiliser Power BI de deux manières :

## Mode classique

```
clic | slicers | drill-down | navigation
```

## Mode IA

```
langage naturel (via le slidebar droit existant)
```

Les deux modes doivent manipuler le même rapport, le même modèle, les mêmes
mesures et les mêmes données. Il ne faut pas créer deux logiques
analytiques contradictoires.

---

# 65. Contrainte de cohérence

Si l'utilisateur clique `Province = Kinshasa` puis demande
« Affiche Nord-Kivu », l'IA doit remplacer ou ajuster le filtre selon le
contexte. Le système doit rendre explicite le nouvel état.
Éviter les accumulations de filtres invisibles.

---

# 66. Contexte IA

Au prompt, transmettre uniquement les métadonnées nécessaires :

```
pages disponibles
bookmarks disponibles
modèle sémantique pertinent
filtres actuels
contexte utilisateur
```

Ne pas envoyer inutilement tout le dataset au LLM.
Le LLM ne doit pas recevoir toutes les lignes de `fact_indicator_values`.
Il doit utiliser : metadata, DAX, résultats agrégés.

---

# 67. Cache DAX

Les requêtes DAX doivent être protégées contre les appels excessifs.

Ajouter :

```
timeout | cache | limitation de fréquence
```

Exemple : même question + même contexte + même période → réutiliser le
résultat.

---

# 68. Sécurité

Le runtime IA doit être en lecture seule.

Ne jamais exposer au LLM :

```
modèle de modification | credentials | client secret | XMLA write | Power BI Admin APIs inutiles
```

Les requêtes DAX côté serveur doivent être :

```
read-only (EVALUATE uniquement)
```

Le DAX Gateway (`src/lib/powerbi/dax-gateway.ts`) valide que chaque requête
commence par `EVALUATE` ou `DEFINE` et rejette les mots-clés interdits
(`INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`).

---

# 69. Logging

Logger :

```
utilisateur/session | intent | outil utilisé | durée | succès/échec | nombre de lignes retournées
```

Ne jamais logger :

```
client_secret | access_token | embed_token
```

---

# 70. Performance

Limiter :

```
nombre de requêtes DAX | taille des résultats | temps d'exécution | fréquence des requêtes
```

Préférer : agrégations, mesures, filtres, cache.
Éviter : retourner toute la fact au LLM.

---

# 71. Validation du modèle

Avant publication :

- relations correctes ;
- cardinalités correctes ;
- aucune relation ambiguë ;
- mesures vérifiées ;
- dates correctes ;
- filtres fonctionnels ;
- géographie cohérente ;
- indicateurs correctement identifiés.

---

# 72. Validation du rapport

Tester :

```
Province | Zone | Antigène | Année | Mois
```

Tester :

```
drill-down | bookmark | navigation | carte | tableau
```

Tester également :

```
aucune donnée | donnée manquante | province sans données | période sans données
```

---

# 73. Intégration Next.js

Le composant existant `PowerBIContainer` remplace l'ancien `iframe` par
`powerbi-client`. Il reçoit `embedToken`, `embedUrl`, `reportId` et
maintient une référence `report`.

Les commandes IA sont enregistrées via `useRegisterCommand` (mécanisme
existant de `AgentProvider`).

---

# 74. Commandes agent

Ajoutées dans `src/lib/agent/commands.ts` :

Commandes client (JS SDK) :

```
powerbi_get_state
powerbi_get_pages
powerbi_get_bookmarks
powerbi_change_page
powerbi_apply_bookmark
powerbi_apply_filters
powerbi_clear_filters
powerbi_export
```

Commandes serveur (REST API) :

```
powerbi_query
powerbi_get_model
```

Les commandes serveur passent par les routes Next.js :

```
/api/powerbi/query
/api/powerbi/model
```

---

# 75. Ne pas coupler le LLM directement au SDK

Le LLM ne doit pas produire du JavaScript.
Il produit une commande structurée :

```json
{
  "command": "powerbi_apply_filters",
  "arguments": { "province": "Kinshasa", "year": 2025 }
}
```

Le code applicatif valide le schéma puis exécute la commande.

---

# 76. Validation des commandes

Chaque commande doit avoir :

```
schema | validation | permissions | error handling
```

Exemple : `province` doit correspondre à une valeur connue du modèle.
Une commande inconnue doit être rejetée.

La whitelist des filtres autorise uniquement :

```
dim_org_units   (province_name, zone_name, name, level)
dim_indicators  (antigen, pev_domain, label, domain)
dim_date        (year, month, year_month, quarter, year_quarter)
```

---

# 77. Tests end-to-end

| Test | Action | Attendu |
| --- | --- | --- |
| A — Affichage | Ouvrir `/dashboard` → Power BI | rapport s'affiche sans iframe |
| B — Filtre classique | Cliquer Kinshasa | rapport mis à jour |
| C — Prompt | « Affiche la couverture Penta3 à Kinshasa en 2025. » | DAX + filtre Kinshasa + filtre 2025 + interprétation |
| D — Seuil | « Montre les zones de santé sous 80 %. » | DAX → liste → filtre → tableau → explication |
| E — Bookmark | « Affiche la vue Penta3. » | `bm_couverture_penta3` appliqué |
| F — Navigation | « Va à la page Couverture vaccinale. » | page existante → activation |

---

# 78. Critères de validation du MVP

Le MVP est validé uniquement si :

- [ ] Supabase connecté
- [ ] Compte read-only utilisé
- [ ] Modèle en étoile fonctionnel
- [ ] `dim_date` fonctionnelle
- [ ] `dim_indicators` correctement documentée
- [ ] `antigen` et `dose` disponibles
- [ ] relations correctes
- [ ] DAX validé contre Supabase
- [ ] mesure de complétude validée
- [ ] page Couverture vaccinale fonctionnelle
- [ ] slicers fonctionnels
- [ ] KPI fonctionnels
- [ ] courbe fonctionnelle
- [ ] bar chart fonctionnel
- [ ] carte fonctionnelle ou fallback documenté
- [ ] tableau ZS fonctionnel
- [ ] bookmarks fonctionnels
- [ ] rapport publié
- [ ] refresh fonctionnel
- [ ] Embedded fonctionnel
- [ ] JS SDK fonctionnel
- [ ] agent capable d'interroger le modèle (DAX REST)
- [ ] agent capable d'appliquer des filtres
- [ ] agent capable de naviguer
- [ ] agent capable d'appliquer un bookmark
- [ ] slidebar IA fonctionnel (AssistantDrawer existant)

---

# 79. Scénario de démonstration final

Utiliser exactement le scénario suivant lors de la démonstration.

**Utilisateur :**

```
Affiche la couverture Penta3 à Kinshasa en 2025.
```

**Système :**

1. identifie Penta3 ;
2. identifie Kinshasa ;
3. identifie 2025 ;
4. interroge le Semantic Model (DAX REST) ;
5. récupère le résultat ;
6. applique les filtres au rapport ;
7. affiche l'interprétation dans le slidebar IA.

Puis :

```
Montre les zones de santé sous 80 %.
```

**Système :**

1. récupère les zones concernées ;
2. applique les filtres ;
3. affiche le tableau ;
4. explique les principaux résultats.

Puis :

```
Affiche la vue nationale.
```

**Système :** applique `bm_vue_nationale`.

Ce scénario constitue le test d'acceptation principal.

---

# 80. Phases futures après validation

Une fois le vertical slice validé, créer les 8 autres pages dans cet ordre :

1. Vue d'ensemble / Executive
2. Performance & Équité
3. Chaîne d'approvisionnement & Stock
4. Chaîne du froid & Équipements
5. Pertes, Consommation & Déchets
6. Qualité des données
7. Gestion PEV & Supervision
8. Surveillance MPV

---

# 81. Architecture finale des 9 pages

1. **Vue d'ensemble / Executive** — Score composite, couverture nationale,
   alertes, carte, top/bottom ZS
2. **Couverture vaccinale** — Penta3, Penta1, BCG, dropout, zéro-dose
3. **Performance & Équité** — score, risque, équité, tendances
4. **Chaîne d'approvisionnement & Stock** — ruptures, stock, surstock,
   péremption
5. **Chaîne du froid & Équipements** — température, conformité,
   équipements, pannes
6. **Pertes, Consommation & Déchets** — pertes, consommation, déchets
7. **Qualité des données** — complétude, promptitude, cohérence, DQA
8. **Gestion PEV & Supervision** — PAO, supervision, actions correctives,
   séances
9. **Surveillance MPV** — PFA, rougeole, laboratoire

---

# 82. Filtres communs

À terme, les pages doivent partager :

```
Province | Zone de santé | Antigène | Dose | Année | Mois | Stratégie
```

L'expérience utilisateur doit rester cohérente entre les pages.

---

# 83. Règle de cohérence Analytics In-App / Power BI

Les deux onglets `Analytics In-App` et `Power BI` doivent utiliser les
mêmes définitions métier.

Exemple : `Penta3 Coverage` doit produire la même définition dans
Supabase, Analytics In-App, Power BI et Agent IA.

Les seuils doivent également être cohérents. Éviter :

```
Power BI = 72 %  |  Analytics = 75 %  |  IA = 70 %
```

pour le même contexte.

---

# 84. Dictionnaire sémantique

Créer un dictionnaire centralisé des indicateurs.
Pour chaque indicateur :

```
code | label | description | domain | antigen | dose | unit
numerator | denominator | target | thresholds | source | visualization
```

Ce dictionnaire constitue le contrat entre :

```
DHIS2 | Supabase | Power BI | Analytics In-App | Agent IA
```

---

# 85. Règle absolue pour l'agent IA

L'agent doit préférer :

```
modèle sémantique + mesures + DAX (REST API)
```

plutôt que :

```
accès direct à Power BI UI ou accès direct aux tables brutes
```

Le rapport est une interface. Le Semantic Model est la source analytique.

---

# 86. Règle absolue pour Power BI Embedded

Le navigateur connaît l'Embed Token.
Le navigateur NE connaît PAS le Client Secret.
Le backend connaît le Client Secret et génère les tokens nécessaires.

---

# 87. Livrables du vertical slice

À la fin de cette phase, produire :

```
PEV_RDC_Analytics.pbix
documentation/model.md
documentation/indicators.md
documentation/dax.md
documentation/bookmarks.md
documentation/powerbi-embedded.md
```

Et documenter :

```
Workspace ID | Report ID | Semantic Model ID
```

Ne jamais documenter :

```
Client Secret | Access Token | Embed Token
```

---

# 88. Ordre d'exécution obligatoire

Respecter strictement cet ordre :

| Phase | Action |
| --- | --- |
| 1 | Vérifier Supabase |
| 2 | Vérifier les indicateurs |
| 3 | Vérifier la sémantique de `value` |
| 4 | Créer/valider `dim_date` |
| 5 | Créer le modèle en étoile |
| 6 | Créer les mesures DAX |
| 7 | Valider DAX contre Supabase |
| 8 | Construire la page Couverture vaccinale |
| 9 | Construire les bookmarks |
| 10 | Tester les filtres |
| 11 | Publier |
| 12 | Configurer refresh |
| 13 | Configurer Embedded |
| 14 | Remplacer iframe par JS SDK |
| 15 | Connecter les commandes IA |
| 16 | Connecter DAX (REST API) |
| 17 | Tester les scénarios IA |
| 18 | Valider le vertical slice |
| 19 | Construire les 8 autres pages |

---

# 89. Définition du « Done »

Le travail est considéré comme terminé uniquement lorsque cette phrase
fonctionne réellement :

> « Affiche la couverture Penta3 à Kinshasa en 2025. »

et que le système :

```
comprend la demande
    ↓
identifie Penta3
    ↓
identifie Kinshasa
    ↓
identifie 2025
    ↓
interroge le Semantic Model (DAX REST)
    ↓
récupère une valeur vérifiée
    ↓
applique les filtres au rapport Embedded
    ↓
affiche la vue correspondante
    ↓
fournit une interprétation IA dans le slidebar droit
```

Puis lorsque :

> « Montre les zones de santé sous 80 % de couverture. »

fonctionne avec :

```
DAX → résultats → filtrage → visualisation → interprétation
```

Ce vertical slice constitue la preuve que l'architecture complète
fonctionne. Une fois cette validation obtenue, les huit autres pages
peuvent être construites sur la même architecture.

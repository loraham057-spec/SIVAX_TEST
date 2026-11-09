# Analyse : Vers une plateforme de Decision Intelligence pour la vaccination en RDC

> Document de synthèse basé sur :
> - `Version 3 analyse plateforme PEV OMS amb.xlsx` — référentiel RDC de 81 indicateurs
> - `Types questions DB Vaccination AMB.xlsx` — catalogue de questions (résultat + diagnostic/causes)
> - Captures d'écran du dashboard Power BI modèle Cameroun
> - Architecture actuelle du backend (`backend/app/agents/decision_assistant.py`, `tools/`)
> - Réflexion ChatGPT fournie en entrée

---

## 1. Ce que disent les livrables

### 1.1 Le référentiel RDC (`Version 3 analyse plateforme`)

81 indicateurs structurés en ~25 domaines, chacun décrit par 22 colonnes :
définition opérationnelle, numérateur/dénominateur, mode de calcul, périodicité,
niveau d'analyse, dimensions, source, système, responsable, cible/seuil, règle
d'interprétation, visualisation recommandée, points de vigilance, priorité
d'intégration, statut de disponibilité.

**Domaines couverts** (regroupés par logique métier) :

| Bloc métier | Domaines | Exemples d'indicateurs |
|---|---|---|
| **Performance vaccinale** | Vaccination de routine, Couverture vaccinale, Suivi vaccinal, Objectifs | Couverture Penta1/Penta3, couverture par antigène, doses administrées, % structures à cible |
| **Équité / Accès** | Équité, Équité vaccinale, Zéro-dose, Sous-vaccinés | Proportion ZS sous seuil, écart max–min, % enfants zéro-dose |
| **Continuité** | Taux d'abandon | Abandon Penta1–Penta3, Penta1–VAR1 |
| **Offre de service** | Accès et utilisation, Communication & demande, Séances | Taux de réalisation des séances, séances fixe/avancée/mobile |
| **Chaîne d'approvisionnement** | Disponibilité, Ruptures, Niveau de stock, Surstock, Sécurité du stock, Commandes, Livraisons, Distribution, Dernier kilomètre, Consommation | Taux de disponibilité, taux de sites en rupture, durée moyenne rupture, mois de stock, sites sous minimum, OTIF, satisfaction commandes |
| **Chaîne du froid** | Chaîne du froid, Équipements, Capacité, Maintenance | Excursions température, sites conformes, statut équipements, disponibilité fonctionnelle, utilisation capacité froide, pannes résolues |
| **Pertes / Traçabilité** | Taux de perte, Gestion des flacons, Péremption, Traçabilité, Déchets, Vaccins & vaccinés | Taux de perte, pertes flacons ouverts/fermés, doses expirant, lots traçables, facteur de perte |
| **Qualité des données** | Qualité des données, Cohérence des données, Données | Complétude SNIS, promptitude, exhaustivité, concordance, sur-déclaration Penta3, rapports non soumis |
| **Surveillance / Sécurité** | Surveillance MPV, Sécurité vaccinale | Taux notification PFA/rougeole/fièvre jaune, AEFI investigués |
| **Gestion PEV** | Gestion PEV/PAO, Supervision | Exécution PAO, couverture supervision, clôture actions correctives |
| **Analyse avancée** | Analyse avancée, Performance globale, Comparaison annuelle | **Alerte précoce baisse couverture**, **ZS à haut risque de sous-performance**, score composite PEV |

**Points clés du référentiel** :
- Chaque indicateur a déjà une **règle d'interprétation** et un **seuil/cible** → matière première pour un moteur de diagnostic.
- Les colonnes `Priorité d'intégration` (Critique/Haute/Moyenne) et `Statut de disponibilité` (Disponible/À intégrer/À valider) donnent une feuille de route de mise en œuvre.
- Deux indicateurs sont explicitement marqués **« Analytics avancé »** : `Alerte précoce baisse de couverture` et `ZS à haut risque de sous-performance`. Ce sont les **killer features** identifiées par le référentiel lui-même.

### 1.2 Le catalogue de questions (`Types questions DB Vaccination`)

25 indicateurs logistiques, chacun décliné en **3 colonnes** :

1. **Question de résultat** — « Combien / Quelle proportion… ? » (le *quoi*)
2. **Questions de diagnostic / causes** — « Pourquoi / Depuis quand / Quelles causes… ? » (le *pourquoi*)
3. **Résultats attendus** — la liste structurée des éléments que la réponse doit contenir (le *rendu*)

C'est exactement la structure **Situation → Diagnostic → Rendu** que ChatGPT propose de généraliser. Le fichier logistique est déjà un **prototype de carte sémantique** : pour chaque indicateur, il dit quels facteurs examiner et quelles sous-informations produire.

Exemple emblématique (ligne `Sites sous le stock minimum`) :
- *Résultat* : nombre et proportion de sites sous le minimum, par vaccin.
- *Diagnostic* : le seuil est-il adapté au délai d'approvisionnement, à l'enclavement, à la consommation ?
- *Rendu* : nombre, proportion, vaccin, quantité manquante, durée, écart au seuil, facteurs de risque, **ordre de priorité pour le réapprovisionnement**.

→ Le système ne doit pas retourner une liste ; il doit **produire un ordre de priorité** et des **facteurs associés**.

### 1.3 Le modèle Power BI Cameroun (captures)

Le dashboard Cameroun est un **tableau de bord analytique classique** : multiples pages, KPI en bandeau, graphiques temporels, cartes, tables de classement, filtres provinciaux. C'est un excellent **outil d'analyste** mais il présente les limites que ChatGPT identifie :
- L'utilisateur doit savoir quoi regarder.
- Aucun enchaînement Situation → Diagnostic → Action.
- Pas de synthèse causale, pas de priorisation explicite, pas de recommandation.

---

## 2. Le diagnostic sur l'architecture actuelle

L'agent actuel (`decision_assistant.py`) est un **LangGraph agent v2** :

```
User Input → context_analysis → router
  ├─ CHAT       → chat_responder → END
  ├─ AMBIGUOUS  → clarification → END
  └─ ACTION     → planner → tool_execution → verification
                     ↑                    │
                     └── retry (×2) ──────┘
                                          ↓
                                 response_generation → END
```

**Forces déjà en place** :
- Le LLM ne génère **ni SQL ni code Power BI** : il produit du JSON validé par une policy engine. C'est un garde-fou de sécurité essentiel.
- `tool_registry` isole 6 outils (powerbi, ml, database, document, notification, dhis2_analysis) avec un **allow-list par rôle**.
- `result_verification` récupère des **verified_facts** depuis DHIS2 (ground-truth) → c'est le germe de la couche « Evidence Builder ».
- `run_dhis2_analysis` accepte déjà `visualization` (auto/kpi/line/bar/pie/table) et `periodPreset` → la notion de *type de rendu* existe.

**Manques par rapport à la cible Decision Intelligence** :

| Cible | État actuel | Écart |
|---|---|---|
| 5 niveaux (Situation→Écart→Diagnostic→Risque→Action) | 1 tool `run_dhis2_analysis` mono-shot | Pas de chaîne d'analyse |
| Carte sémantique des indicateurs (liens causaux) | Aucune | Le LLM « devine » les facteurs à examiner |
| Catalogue d'intelligence (intent → indicateurs → rendu) | Aucun | Chaque question repart de zéro |
| 8 types de rendu (KPI/Ranking/Trend/Diagnostic/Geo/Alert/Comparatif/Brief) | `visualization` enum basique | Pas de rendu Diagnostic, Alert, Brief |
| Score de risque ZS multi-critères | Non implémenté | Indicateur marqué « Critique » dans le référentiel |
| Niveau de confiance sur les hypothèses causales | Aucun | Risque de présenter corrélation = causalité |
| Validation humaine des recommandations | `NEEDS_APPROVAL` existe pour actions à risque | Pas étendu aux recommandations sanitaires |

---

## 3. La proposition : Decision Intelligence pour la vaccination RDC

### 3.1 Positionnement

Ne **pas** présenter la plateforme comme « Power BI + Chatbot IA ». La position :
> **Plateforme de Decision Intelligence pour la vaccination RDC**, capable de transformer une question métier en analyse, diagnostic, identification des zones prioritaires et synthèse décisionnelle — avec justification et validation humaine.

### 3.2 Les 5 niveaux d'analyse au cœur de l'agent

```
DONNÉES → SITUATION → ÉCART → DIAGNOSTIC → RISQUE → ACTION
```

Chaque niveau est un **nœud LangGraph** potentiel, pas une page de dashboard. L'agent enchaîne les niveaux pertinents selon l'intent détecté.

| Niveau | Question métier | Ce que l'agent fait | Rendu type |
|---|---|---|---|
| **Situation** | Où en sommes-nous ? | Calcule les KPI de couverture/doses/dropout/zéro-dose/complétude/promptitude | KPI + sparkline |
| **Écart** | Sommes-nous sous le seuil ? | Compare aux seuils du référentiel et à la période précédente | KPI avec delta + alerte |
| **Diagnostic** | Pourquoi ? | Enchaîne les indicateurs associés (carte sémantique) et construit une hypothèse | Diagnostic Answer + niveau de confiance |
| **Risque** | Où agir en priorité ? | Calcule le score multi-critères ZS à haut risque | Ranking + carte de risque |
| **Action** | Que faire ? | Transforme le diagnostic en recommandations priorisées | Executive Brief + actions suggérées |

### 3.3 La carte sémantique des indicateurs (la pièce maîtresse)

C'est la **couche sémantique** que le LLM traversera au lieu d'attaquer directement les données. Pour chaque indicateur du référentiel RDC, on encode :

```yaml
indicateur: taux_abandon_penta1_penta3
mesure: continuité vaccinale
calcul: (Penta1 - Penta3) / Penta1 × 100
seuil: "<10% (repère)"
niveau_analyse: [aire, ZS, province]
source: DHIS2 PEV
indicateurs_associes:       # à examiner conjointement
  - couverture_penta1
  - couverture_penta3
indicateurs_explicatifs:    # causes probables d'une dégradation
  - taux_sites_rupture
  - taux_realisation_seances
  - taux_disponibilite
  - qualite_completude
indicateurs_consequence:    # ce que cela impacte
  - couverture_var1
  - proportion_zs_sous_seuil
questions_possibles:
  - "Où l'abandon est-il élevé ?"
  - "Pourquoi l'abandon augmente-t-il dans cette ZS ?"
  - "Quelles ZS sont prioritaires sur l'abandon ?"
actions_possibles:
  - "Vérifier les ruptures Penta3 dans les ZS à fort abandon"
  - "Comparer séances planifiées vs réalisées"
type_rendu_defaut: diagnostic
```

**Pourquoi c'est fondamental** : quand un utilisateur demande « Pourquoi la couverture Penta3 est-elle faible dans la ZS X ? », l'agent ne devine pas. Il lit la carte sémantique de `couverture_penta3`, voit que les indicateurs explicatifs sont `[abandon, ruptures, séances, disponibilité, qualité]`, et **planifie une séquence d'analyses** sur ces indicateurs avant de synthétiser. C'est exactement la chaîne proposée par ChatGPT :

```
Penta1 → Penta3 → Dropout → Disponibilité → Ruptures →
Séances réalisées/planifiées → Qualité données → Chaîne du froid
```

### 3.4 Le catalogue d'intelligence (intent → plan → rendu)

Chaque question type du fichier `Types questions DB Vaccination` devient une **Question Intelligence Definition (QID)** :

```yaml
qid: sites_sous_stock_minimum
intent: "identifier_sites_sous_minimum"
question_resultat: "Quels sites et vaccins sont sous le stock minimum ?"
question_diagnostic: "Le seuil est-il adapté au délai, à l'enclavement, à la consommation ?"
indicateurs_necessaires:
  - sites_sous_stock_minimum
  - mois_stock_disponible
  - delai_moyen_reapprovisionnement
dimensions: [periode, antigene, province, ZS, FOSA]
calculs:
  - proportion_sites_sous_minimum
  - ecart_au_seuil
  - duree_sous_stock
analyse_complementaire:
  - commandes_en_attente
  - stock_niveau_superieur
  - historique_rupture
type_visualisation: ranking + carte
type_reponse: ranking_answer
niveau_confiance: calcule (basé sur complétude/promptitude des sources)
action: "prioriser_reapprovisionnement"
```

L'agent ne « devine » pas comment analyser : il dispose d'un **catalogue métier contrôlé**. C'est la différence entre un LLM qui génère du SQL et un **système d'aide à la décision**.

### 3.5 Les 8 types de rendu (Response Renderer)

Le `visualization` enum actuel (`auto/kpi/line/bar/pie/table`) est trop pauvre. À remplacer par un **type de réponse** qui pilote à la fois le composant frontend et le texte de synthèse :

| Type | Déclencheur | Composant frontend | Texte IA |
|---|---|---|---|
| `kpi_answer` | « Quelle est la couverture Penta3 ? » | KPI + delta + sparkline | 1 phrase + tendance |
| `ranking_answer` | « Quelles sont les 10 ZS les moins performantes ? » | Table triée + badge risque + bouton « Analyser » | Top 3 + concentration |
| `trend_answer` | « La couverture s'améliore-t-elle ? » | Série temporelle + annotation baisse | Interprétation + lien « Explorer la cause » |
| `diagnostic_answer` | « Pourquoi cette ZS est-elle faible ? » | Carte des facteurs associés (rouge/orange/jaune) + hypothèse + **niveau de confiance** | Hypothèse principale + facteurs |
| `geographic_answer` | « Où sont les zéro-dose ? » | Carte choroplèthe + légende risque | Top provinces + % concentré |
| `alert_answer` | « Quelles alertes cette semaine ? » | Liste d'alertes cliquables groupées par type | Compte par catégorie |
| `comparative_answer` | « Compare Kinshasa et Kongo Central » | Table comparative + interprétation | Écarts significatifs |
| `executive_brief` | « Résume la situation vaccinale » | Fiche exécutive (Situation/Alertes/Zones prioritaires/Facteurs/Actions/**Données utilisées**) | Synthèse + recommandations |

**Le `executive_brief` est le rendu le plus différenciant** pour un décideur. Il inclut systématiquement un bloc « Données utilisées » (période, niveau, sources) — indispensable pour l'acceptabilité.

### 3.6 Éléments visuels par type de rendu (charts et tableaux)

Chaque type de rendu ne se limite pas à du texte : il associe **un ou plusieurs composants visuels** (graphique + tableau + KPI) choisis selon la nature de la donnée. Le tableau ci-dessous définit, pour chaque rendu, les éléments visuels à afficher et leur agencement.

| Type de rendu | Élément visuel principal | Éléments secondaires | Tableau de données | Règle d'affichage |
|---|---|---|---|---|
| `kpi_answer` | **KPI card** (valeur + delta vs période précédente + sparkline 12 mois) | Badge seuil (🟢🟠🔴) | Non par défaut ; bouton « Voir détail » → tableau | Sparkline toujours visible ; delta coloré |
| `ranking_answer` | **Tableau trié** (rang, ZS, province, valeur, badge risque) | Barres horizontales proportionnelles | **Oui** — tableau principal | Top 10 par défaut ; bouton « Tout voir » |
| `trend_answer` | **Courbe temporelle** (line chart) avec annotation des bausses/hausse | KPI delta en entête | **Oui** — tableau période × valeur sous le graphique | Annotation automatique sur point anormal |
| `diagnostic_answer` | **Carte des facteurs associés** (barres horizontales colorées rouge/orange/jaune par facteur) | KPI de l'indicateur principal en entête | **Oui** — tableau facteur × valeur × seuil × écart | Niveau de confiance affiché sous l'hypothèse |
| `geographic_answer` | **Carte choroplèthe** (RDC, provinces ou ZS colorées par intensité) | Légende risque (4 paliers) | **Oui** — tableau province/ZS × valeur, trié | Top 5 provinces + % concentré en texte |
| `alert_answer` | **Liste d'alertes cliquables** groupées par type (icône + sévérité) | Compteur par catégorie en entête | Non par défaut ; clic sur alerte → tableau détaillé | Alertes critiques en haut ; tri par date |
| `comparative_answer` | **Tableau comparatif** (lignes = indicateurs, colonnes = entités comparées) | Heatmap des écarts (cellules colorées) | **Oui** — tableau principal | Ligne « écart » en bas ; écarts significatifs surlignés |
| `executive_brief` | **Fiche structurée** (sections : Situation / Alertes / Zones prioritaires / Facteurs / Actions) | Mini-carte + mini-graphiques intégrés | **Oui** — tableau des zones prioritaires | Bloc « Données utilisées » en pied de fiche |

**Principes communs à tous les rendus visuels** :

1. **Graphique + tableau toujours jumelés** : un graphique sans tableau de données sous-jacent est insuffisant pour un décideur qui veut vérifier. Le tableau est repliable par défaut mais toujours accessible.
2. **Le graphique s'adapte au type de donnée** :
   - Temporel → courbe (line)
   - Comparaison catégorielle → barres horizontales (bar)
   - Répartition → carte choroplèthe (map) ou barres si < 8 catégories
   - KPI unique → KPI card avec sparkline
   - Flux logistique (reçu → sorti → administré → perdu) → Sankey
3. **Seuils visuels** : chaque graphique affiche la ligne de seuil/cible du référentiel (ex : ligne horizontale à 90 % sur une courbe de couverture, ligne à 10 % sur un dropout). Le référentiel RDC fournit déjà ces seuils dans la colonne `Cible / seuil proposé`.
4. **Coloration sémantique** : 🟢 conforme / 🟠 à surveiller / 🔴 critique — basée sur les seuils du référentiel, pas sur des seuils arbitraires.
5. **Export** : chaque tableau est exportable (CSV/Excel) et chaque graphique est exportable (PNG/SVG) — pour intégration dans les bulletins PEV.
6. **Interactivité** : clic sur une barre / une ligne de tableau / une province sur la carte → relance l'agent sur un diagnostic ciblé de cette entité. C'est le pont entre le dashboard et l'assistant IA.

**Composants frontend à créer** (extension du `visualization` enum actuel) :

```
visualization: "auto" | "kpi" | "line" | "bar" | "pie" | "table"
                 ↓ étendre vers ↓
renderType: "kpi_answer" | "ranking_answer" | "trend_answer" |
            "diagnostic_answer" | "geographic_answer" |
            "alert_answer" | "comparative_answer" | "executive_brief"
```

Chaque `renderType` est un composant React dédié qui orchestre graphique (Recharts/visx) + tableau (TanStack Table) + texte de synthèse (généré par l'agent). Le `renderType` est déterminé par le `response_renderer` du backend en fonction de l'intent et du type de question (cf. catalogue QID).

---

## 4. Architecture cible de l'agent

### 4.1 Graphe LangGraph étendu

```
User Input
    ↓
context_analysis  (intent + entities + niveau d'analyse souhaité)
    ↓
router
    ├─ CHAT       → chat_responder → END
    ├─ AMBIGUOUS  → clarification → END
    └─ ANALYSIS   → analysis_planner
                        ↓
                   semantic_lookup   (lit la carte sémantique)
                        ↓
                   multi_indicator_query  (DHIS2 + logistique + qualité)
                        ↓
                   evidence_builder   (rassemble faits + calcule écarts)
                        ↓
                   diagnostic_engine   (hypothèses causales + confiance)
                        ↓
                   risk_scorer        (score ZS multi-critères)
                        ↓
                   response_renderer  (choisit le type de rendu)
                        ↓
                   response_generation → END
```

### 4.2 Nouveaux outils à ajouter au `tool_registry`

| Outil | Rôle | Source |
|---|---|---|
| `semantic_layer` | Lit la carte sémantique (indicateurs + liens) | YAML/JSON statique dérivé du référentiel RDC |
| `indicator_query` | Calcule un indicateur normalisé (avec seuil, delta, tendance) | DHIS2 + logistique |
| `risk_scorer` | Calcule le score ZS à haut risque (multi-critères configurable) | DHIS2 + logistique + qualité |
| `alert_detector` | Détecte alertes précoces (baisse couverture, rupture prolongée, excursion température) | DHIS2 + logistique |
| `diagnostic_engine` | Construit une hypothèse causale à partir des indicateurs associés | semantic_layer + indicator_query |
| `brief_generator` | Assemble un executive brief structuré | tous les outils ci-dessus |

Le LLM **n'accède jamais directement** à Power BI ou DHIS2. Il demande une analyse via ces outils contrôlés ; le backend détermine ce qui est autorisé (déjà le cas via `is_tool_allowed`).

### 4.3 Le score ZS à haut risque (killer feature)

L'indicateur `ZS à haut risque de sous-performance` (ligne 4 du référentiel) combine :
`couverture + dropout + qualité des données + stock-out + zéro-dose + tendance`.

Implémentation recommandée — **score transparent et paramétrable** (le référentiel l'exige explicitement, colonne R) :

```python
score_zs = (
    w1 * normaliser(1 - couverture_penta3)      # plus c'est bas, plus le risque
  + w2 * normaliser(dropout_penta1_penta3)
  + w3 * normaliser(1 - qualite_completude)
  + w4 * normaliser(taux_sites_rupture)
  + w5 * normaliser(proportion_zero_dose)
  + w6 * normaliser(-tendance_couverture)       # baisse = risque
) / sum(w)
```

Poids par défaut configurables via l'UI settings. Le score **doit être expliqué** (contribution de chaque facteur), pas une boîte noire.

---

## 5. Le dashboard RDC : 5–7 espaces, pas 20 pages

Ne pas reproduire le modèle Cameroun écran par écran. Navigation par **niveaux décisionnels** (tabs), avec l'assistant IA pour l'exploration transversale.

| Espace | Indicateurs du référentiel (extrait) |
|---|---|
| **1. Executive Overview** | Couverture, zéro-dose, dropout, ruptures, qualité, alertes, score composite |
| **2. Performance** | Couverture par antigène, doses administrées, dropout, tendances, comparaisons N/N-1 |
| **3. Équité** | Zéro-dose, sous-vaccinés, écart entre ZS, proportion ZS sous seuil, hotspots |
| **4. Supply Chain** | Stock, ruptures, surstock, commandes, OTIF, mois de stock, sites sous minimum |
| **5. Chaîne du froid** | Excursions, sites conformes, statut équipements, capacité, pannes |
| **6. Service Delivery** | Séances planifiées/réalisées, fixe/avancée/mobile, supervision, PAO |
| **7. Qualité & Surveillance** | Complétude, promptitude, concordance, sur-déclaration, AEFI, surveillance MPV |

L'assistant IA permet de **traverser** ces espaces (« Pourquoi la couverture baisse ? » touche Performance + Supply Chain + Service Delivery + Qualité simultanément — c'est ce que la carte sémantique orchestre).

---

## 6. Exemple complet de parcours agent

**Question** : « Quels sites et quels vaccins sont sous le stock minimum, et depuis combien de temps ? »

| Étape | Nœud agent | Action | Sortie |
|---|---|---|---|
| 1 | context_analysis | intent = `identifier_sites_sous_minimum` | — |
| 2 | semantic_lookup | QID `sites_sous_stock_minimum` → indicateurs + analyse complémentaire | plan d'analyse |
| 3 | multi_indicator_query | Calcule `sites_sous_stock_minimum`, `mois_stock`, `duree_sous_stock` par ZS/vaccin | données brutes |
| 4 | evidence_builder | 127/1042 sites sous seuil = 12,2 % ; top 10 ZS | faits structurés |
| 5 | diagnostic_engine | Concentration sur Penta3 + PCV dans 3 provinces ; examine commandes en attente, stock amont, historique rupture | hypothèse + confiance |
| 6 | risk_scorer | 12 ZS à risque élevé (8 rupture récente, 5 commandes en attente, 4 forte consommation, 3 faible stock amont) | ranking risque |
| 7 | response_renderer | `ranking_answer` + bloc diagnostic + bloc action | rendu structuré |
| 8 | response_generation | Texte + « Pourquoi cette recommandation ? » + « Données utilisées » | réponse finale |

L'utilisateur voit : un tableau top 10, un bloc « Facteurs associés », un bloc « Priorité recommandée », et un bouton « Analyser cette ZS » qui relance l'agent sur un diagnostic ciblé.

---

## 7. Recommandations concrètes de mise en œuvre

### 7.1 Court terme (réutilisable maintenant)

1. **Générer la carte sémantique** depuis le référentiel RDC : un fichier `indicators_semantic_map.yaml` (ou `.py`) dérivé des 81 lignes, avec liens `explicatifs`/`associes`/`consequence` à définir en atelier métier. Le référentiel donne déjà `définition`, `calcul`, `seuil`, `source`, `visualisation` — il manque les liens causaux.
2. **Étendre le `COMMAND_CATALOG`** avec des commandes par type de rendu : `run_diagnostic`, `compute_risk_score`, `generate_brief`, `detect_alerts` — en plus de `run_dhis2_analysis`.
3. **Ajouter un nœud `analysis_planner`** dans le graphe LangGraph qui, pour un intent ANALYSIS, consulte la carte sémantique et produit un **plan multi-indicateur** avant `tool_execution`.
4. **Frontend : 8 composants de rendu** correspondant aux 8 types (KPI/Ranking/Trend/Diagnostic/Geo/Alert/Comparatif/Brief) — le `visualization` enum devient un discriminateur de composant.

### 7.2 Moyen terme

5. **Score ZS à haut risque** : implémenter `risk_scorer` avec poids configurables + décomposition de la contribution (transparence).
6. **Alerte précoce** : baseline historique + seuil configurable + sparkline dans le rendu `alert_answer`.
7. **Niveau de confiance** sur les hypothèses causales : basé sur (complétude × promptitude × concordance) des sources utilisées. Toujours affiché, jamais masqué.
8. **Validation humaine** : les recommandations d'action sanitaire passent en `NEEDS_APPROVAL` (le mécanisme existe déjà pour les actions à risque — l'étendre aux recommandations).

### 7.3 Long terme / avancé

9. **Apprentissage des corrélations** : sur historique, identifier statistiquement les facteurs les plus prédictifs d'une baisse de couverture par ZS (pas de causalité affirmée, mais hiérarchisation des hypothèses). À présenter comme *association*, pas *causalité*.
10. **Recommandations contextualisées** : relier les causes identifiées à un référentiel d'actions PEV (rattrapage, redistribution, supervision, réparation équipement) — l'agent propose l'action la plus pertinente selon le diagnostic.
11. **Suivi d'impact** : fermer la boucle en mesurant si les ZS sur lesquelles une action a été menée s'améliorent — feedback loop pour affiner les poids du score de risque.
12. **Mode offline / mobile** (PWA déjà amorcée dans le repo) : le brief exécutif et les alertes critiques doivent être consultables sans connexion, pour les ECZS en zone enclavée.

---

## 8. Garde-fous éthiques et opérationnels

- **Une recommandation IA n'est jamais une décision sanitaire automatique.** Toujours présentée comme aide à la décision avec justification + validation humaine.
- **Transparence du score de risque** : poids affichés, contribution décomposée, aucune boîte noire.
- **Niveau de confiance explicite** sur chaque hypothèse causale (basé sur la qualité des données sous-jacentes).
- **Traçabilité** : chaque réponse agent logue les indicateurs utilisés, les sources, la période, le niveau — pour audit et amélioration.
- **Données utilisées** toujours affichées dans le rendu (période, niveau, sources) — condition d'acceptabilité par les décideurs.

---

## 9. Synthèse : la différence avec un Power BI Copilot

| | Power BI + Chatbot | **Decision Intelligence (cible)** |
|---|---|---|
| Question → réponse | Texte + graphique | Workflow Situation→Diagnostic→Risque→Action |
| Facteurs causaux | LLM devine | Carte sémantique contrôlée |
| Priorisation | Liste triée | Score multi-critères expliqué |
| Confiance | Implicite | Niveau explicite |
| Recommandation | Absente | Proposée + justifiée + validée |
| Catalogue métier | Aucun | QID par question type |
| Types de rendu | Graphique générique | 8 rendus spécialisés dont Executive Brief |

**Le positionnement final** : une plateforme qui transforme une question métier en parcours décisionnel complet — analyse, diagnostic, identification des zones prioritaires, synthèse — avec justification et validation humaine. C'est cela qui différencie la plateforme d'un simple dashboard augmenté d'un chat.

---

## 10. Bugs observés : divergence chat vs conteneur et clarification excessive

Deux problèmes concrets ont été observés en utilisation réelle. Ils ne sont pas cosmétiques : ils touchent la **fiabilité** et la **confiance** que l'utilisateur place dans l'assistant. Un décideur qui voit deux nombres différents pour la même question ne fera plus confiance à la plateforme.

### 10.1 Bug 1 — Clarification excessive sur une question pourtant claire

**Question posée** :
> « Quel est le nombre de cas de paludisme (présumé et confirmés) dans la province de Kinshasa en mars 2025 ? »

**Comportement observé** : l'assistant demande de clarifier si l'utilisateur veut les cas présumés, les cas confirmés, ou les deux — alors que la question demande **explicitement les deux**.

**Cause racine** : le prompt de `context_analysis` (nœud d'entrée du graphe LangGraph) contient l'instruction :
> « Set confidence LOW (<0.65) when: the request is vague, the indicator is unclear, **multiple interpretations exist**, or critical info is missing. »

Le LLM interprète « présumé ET confirmés » comme **deux interprétations possibles** (au lieu d'une demande explicite pour les deux combinés), fait chuter le `confidence` sous le seuil `CLARIFICATION_THRESHOLD = 0.65`, et le `route_after_analysis` envoie sur le nœud `clarification`.

**Corrections recommandées** :

1. **Affiner le prompt `context_analysis`** — ajouter une règle explicite :
   > « Si l'utilisateur mentionne explicitement plusieurs catégories avec "et" / "et confirmés" / "les deux", cela ne constitue PAS une ambiguïté : c'est une demande pour l'agrégat de toutes les catégories mentionnées. Ne pas baisser la confiance dans ce cas. »

2. **Distinguer "ambiguïté" et "pluralité explicite"** — dans le JSON d'entités, ajouter un champ `aggregation_mode` :
   ```json
   "aggregation_mode": "single" | "all_mentioned" | "ambiguous"
   ```
   - `single` : une seule catégorie mentionnée
   - `all_mentioned` : plusieurs catégories mentionnées explicitement avec "et" → agrégat
   - `ambiguous` : l'utilisateur n'a pas précisé → clarification justifiée

3. **Monter le seuil de clarification pour les intents ANALYZE** — un intent ANALYZE avec une province + une période + un indicateur identifié ne devrait presque jamais être clarifié. Le seuil `0.65` est trop conservateur pour ce cas. Envisager un seuil dynamique : `0.55` pour ANALYZE (quand les entités géographie + période + indicateur sont toutes présentes), `0.65` sinon.

4. **Court-circuiter la clarification si les entités sont complètes** — si `geography`, `period` et `indicator_keywords` sont tous non-nuls, ne pas clarifier même si `confidence` est basse : le LLM sous-estime sa propre confiance. Ajouter dans `route_after_analysis` :
   ```python
   if intent == "ANALYZE" and confidence < CLARIFICATION_THRESHOLD:
       entities = state.get("entities", {})
       has_geo = bool(entities.get("geography"))
       has_period = bool(entities.get("period"))
       has_indicator = bool(entities.get("indicator_keywords"))
       if has_geo and has_period and has_indicator:
           return "planner"  # assez d'info pour procéder
       return "clarification"
   ```

### 10.2 Bug 2 — Divergence entre le chat sidebar et le conteneur analytics

**Question initiale** :
> « Quel est le nombre de cas de paludisme (présumé et confirmés) dans la province de Kinshasa en mars 2025 ? »

**Question de suivi** :
> « Comment se présente l'évolution du nombre jusqu'à juillet 2025 ? »

**Réponse dans le chat sidebar (correcte)** :
```
Période          Nombre de cas
Mars 2025        35 337
Avril 2025       37 691
Mai 2025         38 653
Juin 2025        38 669
Juillet 2025     38 758
Août 2025        39 082
```
→ Données filtrées à **Kinshasa uniquement**, évolution mensuelle correcte, interprétation pertinente.

**Réponse dans le conteneur analytics in-app (incorrecte/divergente)** :
```
Total cumulé : 17 710 920 sur 26 unités géographiques et 6 périodes
Kinshasa Province : 262 0 K (mars 2025)
Bas Uele Province : 38,7 K (mars 2025)
... (26 provinces listées)
Tendance baissière : 2 925 446 → 2 870 242 (-1,9 %)
```
→ Données pour **les 26 provinces** (pas filtrées à Kinshasa), totaux nationaux, chiffres totalement différents.

**Cause racine : deux implémentations DHIS2 indépendantes qui ne partagent rien**

Le codebase contient **deux chemins d'analyse DHIS2 complètement séparés** :

| | Chemin 1 — Chat sidebar | Chemin 2 — Conteneur analytics |
|---|---|---|
| **Fichier** | `backend/app/tools/dhis2.py` → `Dhis2Tool.run_analysis()` | `src/lib/dhis2-analysis.ts` → `runDhis2Analysis()` |
| **Exécuté sur** | Backend Python (agent LangGraph) | Frontend TypeScript (navigateur) |
| **Recherche métrique** | `search_metrics()` (Python) | `searchDhis2Metrics()` (TypeScript) — logique de synonymes différente |
| **Org unit par défaut** | `args.get("orgUnitId") or settings.dhis2_root_ou` | `String(input.orgUnitId ?? "ymGeqzoPhN3")` — **root national** |
| **Résultat** | `verified_facts` (dict structuré) injecté dans le prompt LLM | `Dhis2AnalysisResult` (objet complet avec rows, summary, explanation) |
| **Utilisé par** | `response_generation` → texte du chat | `analysis-store.tsx` → rendu du conteneur |

**Les trois sources de divergence** :

1. **Org unit non propagée** : quand l'agent planifie un `run_dhis2_analysis`, il peut ne pas remplir `orgUnitId` avec l'ID DHIS2 de Kinshasa (le planner LLM ne connaît pas toujours l'ID exact). Le backend `dhis2.py` utilise alors `settings.dhis2_root_ou` (qui peut être Kinshasa si configuré), mais le frontend `dhis2-analysis.ts` **remplace par défaut** `"ymGeqzoPhN3"` (root national). Résultat : le chat interroge Kinshasa, le conteneur interroge toute la RDC.

2. **Recherche de métrique divergente** : `search_metrics` (Python) et `searchDhis2Metrics` (TypeScript) utilisent des logiques de scoring et des synonymes différents. Pour la même question « paludisme présumé et confirmés », le backend peut trouver l'indicateur `PALU - Cas présumés et confirmés` (agrégat) tandis que le frontend trouve un data element différent (ex : cas suspects, ou cas confirmés seuls). D'où des chiffres à des ordres de grandeur différents (35 K vs 262 K).

3. **Aucun partage de résultat** : le backend calcule `verified_facts` pour le chat, mais **ne les renvoie pas au frontend** pour le conteneur. Le frontend refait toute l'analyse depuis zéro, indépendamment, avec des paramètres potentiellement différents. Il n'y a pas de source de vérité unique.

**Corrections recommandées** :

**Correction A — Source de vérité unique (priorité 1)** :

Le backend doit devenir l'**unique point d'analyse DHIS2**. Le frontend ne doit plus appeler `runDhis2Analysis()` de `dhis2-analysis.ts` de manière autonome. À la place :

1. L'agent backend exécute `Dhis2Tool.run_analysis()` et produit **à la fois** `verified_facts` (pour le chat) **et** un `analysis_payload` complet (rows, summary, metric, visualization) pour le conteneur.
2. Le router `/api/agent/chat` renvoie ce `analysis_payload` dans la réponse au frontend.
3. Le frontend `analysis-store.tsx` reçoit le `analysis_payload` de la réponse agent et l'affiche dans le conteneur — **sans refaire d'appel DHIS2**.

```
Avant :  Agent → verified_facts → chat
         Agent → commande → frontend → runDhis2Analysis() → conteneur (diverge)

Après :  Agent → Dhis2Tool → verified_facts + analysis_payload
                              ↓                ↓
                         chat           conteneur (même source)
```

4. Le `Dhis2AnalysisResult` retourné au frontend doit inclure un champ `provenance` avec : metric ID, metric name, org unit ID, org unit name, periods, query exacte — pour que le conteneur affiche **exactement** ce que le chat a utilisé.

**Correction B — Résolution d'org unit côté backend (priorité 1)** :

Le `context_analysis` ou le `planner` doit **résoudre les noms géographiques en IDs DHIS2** avant l'exécution. Ajouter un outil `resolve_org_unit` qui mappe « Kinshasa » → ID DHIS2 de Kinshasa. Le planner remplit alors `orgUnitId` avec l'ID résolu, et ce même ID est propagé au conteneur via le `analysis_payload`.

**Correction C — Unifier la recherche de métrique (priorité 2)** :

La recherche de métrique (`search_metrics` Python et `searchDhis2Metrics` TypeScript) doit être **unifiée côté backend**. Le frontend ne doit plus chercher de métrique lui-même. Si on garde une recherche frontend (pour des cas hors-agent), elle doit appeler une endpoint backend `/api/dhis2/search-metrics` qui utilise la même logique que `search_metrics` Python.

**Correction D — Propager les paramètres explicites (priorité 2)** :

Quand l'utilisateur dit « jusqu'à juillet 2025 », le planner doit générer `periods: ["202503", "202504", "202505", "202506", "202507"]` (ou jusqu'à août si la donnée est disponible). Ces `periods` explicites doivent être **propagés tels quels** au conteneur via le `analysis_payload` — pas recalculés par le frontend.

**Correction E — Indicateur de cohérence dans le conteneur (priorité 3)** :

Le conteneur doit afficher un bandeau « Données utilisées » identique à celui du chat :
```
Indicateur : PALU - Cas de paludisme (présumés et confirmés)
Zone : Kinshasa Province
Périodes : mars 2025 – août 2025
Source : DHIS2 — SNIS RDC
```
Si ce bandeau ne correspond pas à la question posée, l'utilisateur voit immédiatement l'incohérence — au lieu de découvrir des chiffres contradictoires.

### 10.3 Synthèse des deux bugs

| Bug | Impact | Cause | Correction prioritaire |
|---|---|---|---|
| Clarification excessive | Frustration utilisateur, perte de temps | Prompt `context_analysis` trop conservateur sur la pluralité | Affiner le prompt + court-circuiter si entités complètes |
| Divergence chat vs conteneur | **Perte de confiance** — deux nombres différents pour la même question | Deux implémentations DHIS2 indépendantes sans source de vérité unique | **Source de vérité unique** : backend produit `verified_facts` + `analysis_payload`, frontend ne refait pas d'analyse |

**Le bug 2 est le plus grave** : un décideur qui voit 35 337 dans le chat et 262 000 dans le conteneur pour la même question ne sait plus quel chiffre croire. La correction A (source de vérité unique) est la priorité absolue — elle élimine la divergence à la racine au lieu de tenter de synchroniser deux chemins indépendants.

Ces deux bugs illustrent pourquoi l'architecture cible (section 4) met l'**Evidence Builder** comme nœud central : il doit y avoir **une seule source de faits** (`verified_facts` + `analysis_payload`), partagée entre le texte du chat et le rendu visuel du conteneur. Toute divergence entre les deux est un défaut architectural, pas un bug d'affichage.

---

## 11. Disponibilité réelle des données : audit DHIS2 + Supabase

> Vérification effectuée le 15 août 2026 par connexion directe à l'instance DHIS2 SNIS RDC (`https://snisrdc.com`, version 2.40.11.1) et inspection du schéma Supabase.

### 11.1 DHIS2 SNIS RDC — connexion réelle confirmée

**Oui, j'ai accès au DHIS2** : les credentials dans `.env` (`Berly_Lora` / `Berly@2025`) fonctionnent. L'instance est `https://snisrdc.com`, version 2.40.11.1.

**Structure organisationnelle confirmée** :

| Niveau | Nom | Count |
|---|---|---|
| 1 | Pays | 1 (RDC) |
| 2 | Province (DPS) | 26 |
| 3 | Zone de Santé | 519 |
| 4 | Aire de Santé | 10 405 |
| 5 | FOSA | 25 683 |

→ La hiérarchie correspond au référentiel RDC (ZS / Province / National).

### 11.2 Ce que DHIS2 contient réellement pour la vaccination

**Indicateurs (calculés, type Percentage) — avec données réelles** :

| Indicateur DHIS2 | ID | Données? | Exemple (202506, provinces) |
|---|---|---|---|
| Taux couverture Penta1 | `k26tJ22Ncpd` | ✅ Oui | 26 provinces |
| Taux couverture Penta3 | `v9b9aYsA5PM` | ✅ Oui | 26 rows (ex: 7.4 %, 8.0 %, 9.1 %) |
| Taux couverture BCG | `cWJXYKCXrLx` | ✅ Oui | 26 provinces |
| Taux couverture VAP4 | `tNZxs1kE6fy` | ✅ Oui | — |
| Abandon DTC1-DTC3 | `MULXtL8iom8` | ✅ Oui | 26 rows (ex: 6.6 %, 4.9 %, -2.7 %) |
| Enfants complétement vaccinés | `nvPe9ZZiEaH` | ✅ Oui | — |
| Enfants sous-vaccinés | `RMHgIqfBG7N` | ✅ Oui | — |
| Taux de perte des vaccins | `YM7Tmn01ieL` | ✅ Oui | — |
| Dropout MR1→MR2 | `FhQ8Hd5rCHj` | ✅ Oui | — |

**Data elements agrégés (série "B 8.4") — avec données réelles** :

| Data element | ID | Données? | Exemple (202506, provinces) |
|---|---|---|---|
| B 8.4 BCG (doses administrées agrégées) | `W25tOXS0rxS` | ✅ Oui | 26 rows (ex: 10 949, 17 062, 13 004) |
| B 8.4 DTC-HepB Hib 1 | `uNdFg1eymsa` | ✅ Oui | 26 rows (ex: 8 329, 15 427, 61 594) |
| B 8.4 DTC-HepB Hib 3 | `WWxqaHSeiwd` | ✅ Oui | 26 rows (ex: 9 223, 81 370, 34 330) |
| B 8.5 Enfants récupérés CAC-BCG | `hF8wVIOJrT8` | ✅ Oui | 26 rows |

**Data elements logistiques (série "B 6.1") — métadonnées présentes mais 0 donnée** :

| Data element | ID | Données? |
|---|---|---|
| B 6.1 BCG doses - administré | `dBTmF4vNJZ3` | ❌ 0 rows (analytics ET dataValueSets) |
| B 6.1 BCG doses - jours de rupture | `oJ926UXBltO` | ❌ 0 rows |
| B 6.1 BCG doses - reçu / stock / utilisé / perdu | (5 elements) | ❌ 0 rows |
| B 6.1 VPO doses - jours de rupture | `oYdDNWlZCot` | ❌ 0 rows |
| B 6.1 DTC-HepB-Hib doses - administré | `ypQTo1o0Slx` | ❌ 0 rows |

→ **La série "B 6.1" (logistique vaccinale détaillée : stock, ruptures, reçus, pertes par vaccin) existe dans les métadonnées DHIS2 mais n'a pas de données saisies** — ni via l'API analytics, ni via dataValueSets, à aucun niveau (national, province, ZS) ni période testée (202412, 202501, 202503, 202506).

**Ce qui n'existe pas du tout dans DHIS2** (recherche infructueuse) :

| Concept du référentiel | Recherche DHIS2 | Résultat |
|---|---|---|
| Zéro-dose | `zero`, `zero dose`, `0 dose`, `non vaccin` | ❌ Aucun indicateur / data element de vaccination |
| Complétude (vaccination) | `completude` | ❌ 0 data element |
| Séances (planifiées/réalisées) | `seance` | ❌ 0 data element |
| Chaîne du froid / température | `temperature`, `chaine du froid`, `frigorifique`, `excursion` | ❌ 0 data element |
| Équipements | `equipement` | ❌ 0 data element |

### 11.3 Cartographie : référentiel RDC vs disponibilité DHIS2

Sur les 81 indicateurs du référentiel, voici la disponibilité réelle dans DHIS2 SNIS RDC :

| Bloc du référentiel | Indicateurs | Disponibles dans DHIS2 ? |
|---|---|---|
| **Couverture vaccinale** (Penta1/3, BCG, VAP, par antigène) | ~8 | ✅ **Oui** — indicateurs Percentage avec données |
| **Abandon / Dropout** (DTC1-DTC3, MR1-MR2) | ~3 | ✅ **Oui** — indicateurs avec données |
| **Doses administrées** (agrégées B 8.4) | ~10 | ✅ **Oui** — data elements B 8.4 avec données |
| **Zéro-dose / Sous-vaccinés** | ~3 | ⚠️ **Partiel** — indicateur "sous-vaccinés" existe, mais pas de data element "zéro-dose" direct |
| **Logistique vaccinale détaillée** (stock, ruptures, reçus, pertes par vaccin) | ~20 | ❌ **Non** — série B 6.1 existe en métadonnées mais **0 donnée saisie** |
| **Chaîne du froid** (excursions, température, équipements) | ~8 | ❌ **Non** — aucun data element dans DHIS2 |
| **Séances** (planifiées/réalisées, fixe/avancée/mobile) | ~6 | ❌ **Non** — aucun data element dans DHIS2 |
| **Qualité des données** (complétude, promptitude, concordance) | ~9 | ❌ **Non** — aucun data element "completude" dans DHIS2 |
| **Surveillance MPV / AEFI** | ~6 | ⚠️ **Partiel** — data elements "Non Vacciné" (DVD MT) existent mais à confirmer |
| **Score de risque ZS** | 1 | ❌ **Non** — à calculer (indicateur composite, pas dans DHIS2) |
| **Alerte précoce** | 1 | ❌ **Non** — à calculer (analytics avancé) |

**Estimation** : ~20-25 indicateurs sur 81 sont directement disponibles dans DHIS2 avec des données réelles. Les autres nécessitent soit des sources externes (OpenLMIS pour la logistique, modules température pour la chaîne du froid), soit un calcul dérivé (score de risque, alertes), soit ne sont pas encore collectés.

### 11.4 Supabase — données mock/seed confirmées

**Oui, une partie des données dans Supabase est du mock/seed**. Voici le détail :

| Table Supabase | Source des données | Réel ou mock ? |
|---|---|---|
| `users` | Seed script (`002_seed_admin_users.sql`) — 4 utilisateurs admin réels (Fidel, Joseph, Berly, Alain) | ✅ Réel (utilisateurs de test) |
| `kpis` | Seed dans migration `011_create_alerts_activity_kpis.sql` | ❌ **MOCK** — données TB (tuberculose), pas vaccination |
| `alerts` | Seed dans migration `011` | ❌ **MOCK** — alertes TB fictives ("TB Detection Rate Below Threshold", "Predicted Outbreak Risk") |
| `activity_log` | Seed dans migration `011` | ❌ **MOCK** — activité fictive |
| `dim_indicators` | Seed dans migration `001_etl_dhis2.sql` | ⚠️ **Partiel** — seulement 4 indicateurs (paludisme ×3 + accouchements), **aucun indicateur vaccination** |
| `dim_org_units` | Seed + ETL | ⚠️ **Partiel** — seulement la racine RDC (`ymGeqzoPhN3`), pas les provinces/ZS |
| `fact_indicator_values` | ETL DHIS2 → Supabase | ⚠️ **Vide ou quasi-vide** — l'ETL ne sync que 4 indicateurs paludisme/maternal, **aucun indicateur vaccination** |
| `etl_runs` | ETL scheduler | ⚠️ **Incertain** — le scheduler tourne à 03:00 UTC mais l'ETL ne sync que 4 indicateurs |

**Le problème critique** : le dashboard affiche des KPIs qui viennent de la table `kpis` (seed mock TB), pas de DHIS2. La route `/api/kpis` lit directement Supabase `kpis` — ces KPIs sont **statiques, mockés, et sur la tuberculose** (pas la vaccination).

### 11.5 L'ETL ne synchronise pas la vaccination

Le fichier `backend/app/etl/sources/dhis2.py` ne contient que 4 indicateurs :

```python
INDICATORS = [
    {"id": "rOt4BctnRqS", "label": "Cas de paludisme (présumés et confirmés)"},
    {"id": "l5Gjya9Udz7", "label": "Paludisme confirmé traité"},
    {"id": "rPYLomUceL4", "label": "Paludisme confirmé (microscopie/TDR)"},
    {"id": "eVbOZqoI7JP", "label": "Accouchements assistés par personnel qualifié"},
]
```

**Aucun indicateur de vaccination** n'est dans cette liste. L'ETL, même s'il tourne, ne synchronise pas Penta1, Penta3, BCG, dropout, zéro-dose, ruptures, etc. dans Supabase.

### 11.6 Ce que cela signifie pour l'analyse

1. **L'assistant IA (chat) utilise DHIS2 en temps réel** — les réponses du chat sont basées sur des données réelles (quand l'indicateur existe et a des données). C'est pourquoi la réponse du chat sur le paludisme était correcte.

2. **Le dashboard (KPIs, alertes) utilise des données mock Supabase** — les KPIs affichés ("Total Cases 1,284,592", "Treatment Success Rate 87.3%") sont des seed data TB, pas des données vaccination réelles.

3. **Pour la vaccination, DHIS2 a les indicateurs de couverture et d'abandon** (Penta1, Penta3, BCG, dropout) avec des données réelles au niveau province. Mais **la logistique détaillée (stock, ruptures, chaîne du froid) n'est pas saisie dans DHIS2**.

4. **Le score de risque ZS et l'alerte précoce** (les killer features) ne peuvent pas être calculés actuellement car ils nécessitent des indicateurs logistiques + qualité des données qui ne sont pas dans DHIS2.

### 11.7 Recommandations pour combler les gaps de données

| Gap | Solution | Priorité |
|---|---|---|
| KPIs dashboard = mock TB | Remplacer le seed `kpis` par des KPIs calculés depuis DHIS2 (couverture Penta3, dropout, etc.) via l'ETL | **Critique** |
| ETL ne sync pas la vaccination | Ajouter les indicateurs vaccination (Penta1/3, BCG, VAP, dropout, doses B 8.4) dans `INDICATORS` de `dhis2.py` | **Critique** |
| Alertes = mock TB | Remplacer par des alertes calculées (baisse couverture, dropout > seuil) depuis les données DHIS2 réelles | **Haute** |
| Logistique vaccinale absente de DHIS2 | Source alternative : OpenLMIS / eLMIS RDC (si disponible) ou formulaire ODK dédié | **Moyenne** (dépend de la disponibilité de la source) |
| Chaîne du froid absente de DHIS2 | Source alternative : capteurs température (Zetes / ColdTrace) ou module DHIS2 à créer | **Moyenne** |
| Séances planifiées/réalisées absentes | Source : Microplan PEV (Excel/ODK) — pas encore dans DHIS2 | **Moyenne** |
| Zéro-dose non mesurable directement | Calcul dérivé : `cible Penta1 - Penta1 administré` (avec précautions sur le dénominateur, cf. référentiel colonne R) | **Haute** |
| Score de risque ZS | Calculable avec les indicateurs disponibles (couverture + dropout + tendance) — version réduite en attendant la logistique | **Haute** |
| Complétude / promptitude | Récupérable via l'API DHIS2 `dataSetReport` ou `dataCompleteness` (pas un data element, mais une méta-donnée de reporting) | **Haute** |

**Le score de risque ZS peut être calculé en version réduite dès maintenant** avec les indicateurs disponibles : couverture Penta3 + dropout + tendance (baisse vs baseline). Les dimensions logistique et qualité pourront être ajoutées quand les sources seront disponibles. Mieux vaut un score partiel transparent qu'un score complet basé sur des données mock.

### 11.8 Conclusion de l'audit

**DHIS2 fournit les données pour environ 20-25 des 81 indicateurs du référentiel** — principalement la couverture vaccinale, les doses administrées agrégées et l'abandon. La logistique détaillée, la chaîne du froid, les séances et la qualité des données ne sont pas dans DHIS2 (soit pas saisies, soit dans d'autres systèmes).

**Supabase contient effectivement des données mock** pour les KPIs et alertes du dashboard (seed TB, pas vaccination). L'ETL ne synchronise que 4 indicateurs paludisme/maternal — **aucun indicateur vaccination**.

**L'assistant IA (chat) est la partie la plus fiable** car il interroge DHIS2 en temps réel. Le dashboard est la partie la moins fiable car il affiche des données statiques mockées.

**Action immédiate recommandée** : étendre l'ETL pour synchroniser les indicateurs vaccination disponibles dans DHIS2, et remplacer les KPIs/alertes mock par des valeurs calculées depuis ces données réelles. Le score de risque ZS peut démarrer en version réduite (couverture + dropout + tendance) avec les données disponibles aujourd'hui.

---

## 12. Bug critique : hallucination de chiffres et fact_check défaillant

### 12.1 L'incident observé

**Question 1** : « Quel est le nombre de cas de paludisme (présumé et confirmés) dans la province de Kinshasa en mars 2025 ? »

**Réponse 1** : tableau avec mars 2025 = 262 045 (correspond à la valeur province de Kinshasa dans le breakdown 26 provinces).

**Question 2** : « Comment se présente l'évolution du nombre jusqu'à juillet 2025 ? »

**Réponse 2** : tableau avec mars 2025 = 1 326 569 (chiffre complètement différent pour la même période/zone).

**Question 3 (challenge)** : « Pourquoi mars 2025 = 262 045 dans le premier tableau et 1 326 569 dans le deuxième ? »

**Réponse 3** : l'assistant "s'excuse", "corrige" avec mars = 1 326 569, avril = 2 925 446, mai = 2 938 551 — qui sont en réalité des **totaux nationaux** (toutes provinces confondues) présentés comme des chiffres de Kinshasa.

**Résultat** : trois réponses successives avec trois jeux de chiffres différents pour la même question, et la "correction" est **plus fausse que l'original**. C'est le scénario le plus destructeur pour la confiance d'un décideur.

### 12.2 Pourquoi le `fact_check` n'a pas attrapé l'erreur

Le nœud `fact_check` (lignes 583-635 de `decision_assistant.py`) est censé vérifier que chaque chiffre dans la réponse correspond aux données vérifiées. Voici pourquoi il a échoué :

**Défaut 1 — Vérification par appartenance à un ensemble, pas par cellule**

```python
# Code actuel :
verified_values = {round(v, 2) for v in facts.get("values", [])}
claimed = _extract_numbers(response_text)
hallucinated = [n for n in significant
    if not any(abs(n - v) <= max(abs(v) * 0.02, 1) for v in verified_values)]
```

Le `fact_check` extrait TOUS les nombres de la réponse et vérifie si chaque nombre existe **quelque part** dans `verified_values`. Mais il ne vérifie PAS que « mars 2025 = 1 326 569 » correspond au fait vérifié pour **mars 2025 spécifiquement**. Si 1 326 569 est dans l'ensemble (parce que c'est un total national qui a été récupéré), le check passe — même si ce chiffre est attribué à tort à Kinshasa.

**Le problème** : `facts["values"]` est un **set plat de nombres sans association période/zone** :
```python
"values": sorted({round(v, 2) for v in values})  # juste des nombres, pas de contexte
```

Si la requête DHIS2 retourne 26 provinces × 6 périodes = 156 valeurs, toutes ces valeurs sont dans le set. Le LLM peut piocher n'importe laquelle et l'attribuer à n'importe quelle période/zone — le check passera tant que le nombre existe quelque part dans les 156 valeurs.

**Défaut 2 — Pas de re-requête DHIS2 sur challenge**

Quand l'utilisateur challenge (« pourquoi 262K vs 1.3M ? »), l'agent ne re-exécute PAS `run_dhis2_analysis`. Il passe par `context_analysis` → probablement `chat_responder` (intent CHAT) → le LLM génère une "correction" depuis l'historique de conversation, qui contient les chiffres contradictoires précédents. Aucune nouvelle donnée DHIS2 n'est récupérée pour vérifier.

**Défaut 3 — Pollution de l'historique de conversation**

L'historique (`state["messages"]`) contient les réponses précédentes avec les mauvais chiffres. Quand le `fact_check` régénère, il fait :
```python
messages = [system] + state["messages"]  # contient les mauvais chiffres !
response = _llm(temperature=0).invoke(messages)
```

Le LLM voit les chiffres contradictoires dans l'historique et en choisit un arbitrairement. La régénération peut **propager l'erreur** au lieu de la corriger.

**Défaut 4 — `verified_facts` non rafraîchi entre les tours**

Quand l'utilisateur pose la question 2 (« évolution jusqu'à juillet »), si l'agent ne re-déclenche pas `run_dhis2_analysis` (parce qu'il considère que c'est une question de suivi CHAT), `verified_facts` reste celui de la question 1 (qui ne couvrait que mars 2025). Le LLM génère des chiffres pour avril-juillet **sans aucune donnée vérifiée** — et le `fact_check` ne peut pas vérifier car il n'y a pas de facts pour ces périodes.

**Défaut 5 — Le seuil de signification filtre trop**

```python
significant = [n for n in claimed if abs(n) >= 10]
```

Les chiffres < 10 ne sont pas vérifiés. Pour des indicateurs en pourcentage (couverture = 7.4 %, dropout = 6.6 %), ces valeurs passent sous le radar. Or ce sont précisément les indicateurs vaccination les plus importants.

### 12.3 Trace de l'incident reconstituée

```
Question 1 : "cas paludisme Kinshasa mars 2025"
  → run_dhis2_analysis (orgUnitId = root national, pas Kinshasa !)
  → DHIS2 retourne 26 provinces × 1 période
  → verified_facts["values"] = {262045, 10949, 17062, ...} (26 valeurs)
  → LLM génère : "Kinshasa mars 2025 = 262 045" (correct par chance — il a pioché la bonne valeur)
  → fact_check : 262045 ∈ verified_values ✓ → PASS

Question 2 : "évolution jusqu'à juillet 2025"
  → run_dhis2_analysis (peut-être re-déclenché, peut-être pas)
  → Si re-déclenché : DHIS2 retourne 26 provinces × 5 périodes = 130 valeurs
    → verified_facts["values"] = {262045, 1326569, 2925446, ...} (130 valeurs)
    → LLM génère : "mars = 1 326 569" (il a pioché un TOTAL NATIONAL au lieu de Kinshasa)
    → fact_check : 1326569 ∈ verified_values ✓ → PASS (le nombre existe, mais c'est le mauvais !)
  → Si non re-déclenché : pas de nouveau verified_facts
    → LLM invente des chiffres depuis l'historique
    → fact_check : soit pas de facts (PASS trivial), soit les chiffres sont dans l'ancien set

Question 3 : "pourquoi 262K vs 1.3M ?"
  → intent = CHAT (pas ANALYZE)
  → chat_responder génère une "correction" depuis l'historique
  → Aucun fact_check (chat_responder ne passe pas par fact_check !)
  → LLM "corrige" avec 1 326 569 + 2 925 446 + 2 938 551 (totaux nationaux)
  → Présentés comme chiffres Kinshasa → FAUX
```

### 12.4 Corrections recommandées

**Correction 1 — Vérification par cellule (période × org_unit), pas par set plat** (priorité critique)

Remplacer le set plat `verified_values` par une structure qui associe chaque valeur à sa période et son org_unit :

```python
# Au lieu de :
"values": sorted({round(v, 2) for v in values})

# Utiliser :
"cells": [
    {"period": "202503", "org_unit": "TwSa8zUu09Q", "org_unit_name": "Kinshasa", "value": 262045},
    {"period": "202503", "org_unit": "rWrCdr321Qu", "org_unit_name": "Équateur", "value": 10949},
    ...
]
```

Le `fact_check` doit alors parser le tableau Markdown de la réponse et vérifier **chaque cellule** (période × valeur) contre la cellule correspondante dans `verified_facts["cells"]`. Si la réponse dit « mars 2025 = 1 326 569 » mais que la cellule vérifiée pour mars 2025 + Kinshasa = 262 045, c'est un mismatch détecté.

**Correction 2 — Le `fact_check` doit connaître le scope de la question** (priorité critique)

Le `fact_check` doit savoir que la question portait sur **Kinshasa**, pas sur la RDC entière. Si la réponse contient un chiffre qui correspond à un total national mais que la question portait sur Kinshasa, c'est une erreur — même si le chiffre existe dans `verified_values`.

Ajouter au `verified_facts` :
```python
"query_scope": {
    "org_unit_id": "TwSa8zUu09Q",
    "org_unit_name": "Kinshasa Province",
    "periods": ["202503", "202504", "202505", "202506", "202507"],
}
```

Le `fact_check` vérifie alors que les chiffres de la réponse correspondent aux cellules dont l'`org_unit` matche le `query_scope`.

**Correction 3 — Re-déclencher `run_dhis2_analysis` sur challenge** (priorité critique)

Quand un utilisateur challenge un chiffre (« pourquoi X vs Y ? »), l'agent doit **systématiquement re-exécuter la requête DHIS2** avec les paramètres exacts de la question originale, au lieu de générer une "correction" depuis l'historique.

Détecter les challenges dans `context_analysis` :
```python
# Ajouter un intent CHALLENGE
"intent": one of [..., CHALLENGE]
# ou détecter : "pourquoi", "pas correct", "différent", "contradiction", "erreur"
```

Router les CHALLENGE vers un nœud `re_verify` qui :
1. Identifie la question originale dans l'historique
2. Re-exécute `run_dhis2_analysis` avec les mêmes paramètres
3. Compare les nouveaux `verified_facts` avec les chiffres de la réponse précédente
4. Génère une réponse basée sur les faits frais, pas sur l'historique

**Correction 4 — Nettoyer l'historique des chiffres non vérifiés** (priorité haute)

Avant de régénérer dans `fact_check`, retirer des messages les réponses précédentes qui contiennent des chiffres hallucinés. Sinon le LLM reproduit l'erreur.

```python
# Au lieu de :
messages = [system] + state["messages"]

# Utiliser :
clean_messages = [m for m in state["messages"]
    if m not in state.get("contaminated_messages", [])]
messages = [system] + clean_messages
```

Ou plus simple : ne passer que le `HumanMessage` original + le `SystemMessage` de correction + les `verified_facts`, **sans l'historique pollué**.

**Correction 5 — Le `chat_responder` doit aussi passer par `fact_check`** (priorité haute)

Actuellement, seules les réponses du pipeline ACTION passent par `fact_check`. Les réponses `chat_responder` (intent CHAT) n'ont **aucune vérification**. Or, un challenge (« pourquoi ces chiffres ? ») est classifié CHAT et passe par `chat_responder` — sans fact_check.

Ajouter une edge `chat_responder → fact_check` quand des `verified_facts` sont disponibles dans le state (d'un tour précédent), ou forcer le re-router vers le pipeline ACTION quand le message contient un challenge de chiffres.

**Correction 6 — Abaisser le seuil de signification** (priorité moyenne)

```python
# Au lieu de :
significant = [n for n in claimed if abs(n) >= 10]

# Utiliser :
significant = [n for n in claimed if abs(n) >= 0.1]  # vérifier aussi les pourcentages
```

Les indicateurs vaccination (couverture 7.4 %, dropout 6.6 %) doivent être vérifiés aussi.

**Correction 7 — Marquage de confiance dans la réponse** (priorité moyenne)

Chaque chiffre dans la réponse doit être annoté avec son niveau de confiance :
- ✅ Vérifié contre DHIS2 (cellule exacte matchée)
- ⚠️ Estimé (calcul dérivé, pas de donnée directe)
- ❌ Non vérifié (pas de donnée DHIS2 pour cette période/zone)

Le frontend peut afficher ces badges à côté de chaque chiffre dans le tableau.

### 12.5 Architecture cible du fact_check

```
response_generation
    ↓
fact_check (v2)
    ├── 1. Parser le tableau Markdown de la réponse
    ├── 2. Pour chaque cellule (période × valeur) :
    │       ├── Trouver la cellule correspondante dans verified_facts["cells"]
    │       ├── Vérifier que l'org_unit matche le query_scope
    │       └── Si mismatch → flag comme halluciné
    ├── 3. Pour chaque chiffre hors tableau :
    │       ├── Vérifier qu'il correspond à un agrégat légitime
    │       └── (total, moyenne, delta) calculable depuis les cellules
    ├── 4. Si hallucinations détectées :
    │       ├── Re-executer run_dhis2_analysis (pas régénérer depuis l'historique)
    │       ├── Régénérer avec les faits frais SANS l'historique pollué
    │       └── Marquer fact_retries + 1
    └── 5. Si challenge détecté dans le message utilisateur :
            └── Forcer le re-router vers le pipeline ACTION (pas chat_responder)
```

### 12.6 Synthèse

| Défaut | Impact | Correction |
|---|---|---|
| Set plat sans contexte période/zone | Chiffre bon mais attribué à la mauvaise période/zone → passe le check | **Vérification par cellule** (période × org_unit) |
| Pas de re-requête sur challenge | "Correction" générée depuis l'historique pollué | **Re-exécuter DHIS2** sur challenge |
| Historique pollué | Régénération reproduit l'erreur | **Nettoyer l'historique** avant régénération |
| `chat_responder` sans fact_check | Les challenges (intent CHAT) n'ont aucune vérification | **Étendre fact_check** à chat_responder |
| Seuil ≥ 10 | Pourcentages vaccination non vérifiés | **Abaisser à 0.1** |
| Pas de marquage de confiance | L'utilisateur ne sait pas quels chiffres sont fiables | **Badges ✅⚠️❌** par chiffre |

**L'incident observé est la conséquence directe de ces 6 défauts combinés**. Le `fact_check` actuel est une vérification syntaxique (le nombre existe-t-il quelque part ?) et non sémantique (le nombre correspond-il à la bonne période et la bonne zone ?). Tant que cette distinction n'est pas implémentée, l'assistant produira des chiffres contradictoires et les "corrigera" avec d'autres chiffres faux — détruisant la confiance de l'utilisateur à chaque tour.

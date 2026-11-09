# Spécification du contenu des 8 pages d'analyse Analytics

> Référence : `POWERBI_DESKTOP_INSTRUCTIONS.md` (modèle 9 pages, DAX, star schema),
> `ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md` (cadre 81 indicateurs RDC, 8 render types),
> `src/lib/pev/indicators.ts` (catalogue indicateurs + seuils OMS),
> migrations Supabase 015/016 (UIDs DHIS2 confirmés avec données réelles),
> captures d'écran Power BI Cameroun (structure : KPI bandeau + courbes + cartes + tables de classement + filtres provinciaux).
>
> La page **2 — Couverture vaccinale** est déjà implémentée (`VisualizationGrid`).
> Ce document spécifie le contenu des **8 autres pages** (1, 3, 4, 5, 6, 7, 8, 9).

---

## Conventions communes à toutes les pages

### Filtres partagés (barre analyste, déjà en place via `useDashboardFilters`)
- **Province** → Zone de santé → Aire de santé → FOSA (hiérarchie `dim_org_units`)
- **Antigène** (quand pertinent : coverage, wastage, supply, coldchain, surveillance)
- **Période** : preset (12 derniers mois, année courante, année précédente) ou plage custom
- **Jeu de données** DHIS2 (optionnel, pour les pages dataquality/supply)

### Source de données (pattern Supabase-first → DHIS2 live fallback)
- `fact_indicator_values` (ETL sync, instantané) → fallback DHIS2 live via `dhis2Service.getFilteredAnalytics`
- Route `/api/dhis2/supabase-query` pour les filtres non liés à un dataset
- Route `/api/provinces?domain=vaccination` pour les classements provinciaux

### Composants réutilisables déjà disponibles
| Composant | Usage |
|---|---|
| `Dhis2KpiGrid` | KPI cards (valeur + delta + sparkline + seuil OMS) |
| `Dhis2TrendChart` | Courbe d'évolution mensuelle |
| `Dhis2TrendBarChart` | Histogramme comparatif |
| `Dhis2StackedBarChart` | Barres empilées (multi-indicateurs) |
| `Dhis2PieChart` | Donut (répartition) |
| `Dhis2ChoroplethMap` | Carte choroplèthe RDC (Leaflet) |
| `CoverageTable` | Tableau détaillé triable |
| `Dhis2FilterBar` | Barre de filtres analyste |
| `Dhis2CompositeIndicators` | Indicateurs composites (CFR, etc.) |
| `Dhis2DataTable` | Tableau de données brut |

### Codes couleur des seuils (communs via `kpi-thresholds.ts`)
- 🟢 Conforme (≥ target) — 🟠 À surveiller (warning → target) — 🔴 Critique (< low)

---

## Page 1 — Vue d'ensemble / Executive

**Objectif** : Tableau de bord synthétique pour le décideur — "Où en est la vaccination nationale en un coup d'œil ?"

### 1.1 KPI Cards (bandeau supérieur, 4 cartes)
| KPI | Indicateur DHIS2 | UID | Seuils OMS |
|---|---|---|---|
| Couverture Penta3 (national) | Taux de couverture Penta3 | `v9b9aYsA5PM` | <60 🔴 / 60-80 🟠 / ≥90 🟢 |
| Couverture BCG (national) | Taux de couverture BCG | `cWJXYKCXrLx` | <70 🔴 / 70-85 🟠 / ≥95 🟢 |
| Abandon Penta1-Penta3 | Taux d'abandon DTC-HepB-Hib | `MULXtL8iom8` | >15 🔴 / 10-15 🟠 / ≤5 🟢 |
| Enfants sous-vaccinés | Nombre d'enfants sous-vaccinés | `RMHgIqfBG7N` | (comptage, pas de seuil %) |

Chaque carte : valeur actuelle + delta vs période précédente + sparkline 12 mois + badge seuil.

### 1.2 Score composite PEV (carte centrale, pleine largeur)
- **Score composite national** (0-100) = moyenne pondérée :
  - Couverture Penta3 (30%) + Couverture BCG (15%) + Abandon Penta3 inversé (25%) + Sous-vaccinés normalisé (10%) + Complètement vaccinés (20%)
- Affichage : jauge semi-circulaire + niveau (Faible < 30 / Modéré 30-49 / Élevé 50-69 / Critique ≥ 70)
- Réutilisation : logique de `risk-zones.tsx` (déjà implémentée pour le score de risque)

### 1.3 Carte de situation (choroplèthe, demi-largeur)
- Indicateur coloré : Couverture Penta3 par province
- Légende : rouge (< 60%) → orange (60-80%) → vert (≥ 90%)
- Composant : `Dhis2ChoroplethMap`

### 1.4 Top 5 / Bottom 5 zones de santé (tableau, demi-largeur)
- Colonnes : Rang | Zone de santé | Province | Couverture Penta3 | Statut (badge)
- Tri : Penta3 ascendant (zones les plus faibles en haut)
- Objectif : identifier immédiatement les zones prioritaires

### 1.5 Alertes actives (bandeau inférieur)
- Réutilisation : `ExecutiveOverview` (déjà implémenté, fetch `/api/alerts`)
- Compteur : X critiques / Y avertissements
- Top 5 alertes triées par sévérité

### 1.6 Synthèse textuelle (footer)
- Texte généré : "La couverture Penta3 nationale est de X% (cible OMS 90%). N provinces sous le seuil. Z zones de santé prioritaires identifiées."

---

## Page 3 — Performance & Équité

**Objectif** : Analyser la performance du programme et les inégalités d'accès entre zones.

### 3.1 KPI Cards (4 cartes)
| KPI | Source | Calcul |
|---|---|---|
| Score de performance moyen | Composite | Moyenne pondérée (cf. Page 1) |
| Provinces sous le seuil Penta3 | `/api/provinces` | Count où Penta3 < 80% |
| Indice d'équité (écart max-min) | `/api/provinces` | Max(Penta3) − Min(Penta3) par province |
| Ratio d'inégalité | `/api/provinces` | Max(Penta3) / Min(Penta3) |

### 3.2 Sélecteur d'indicateur (pills)
- Penta3 | Penta1 | BCG | VAP4 | Abandon Penta1-Penta3 | Abandon MR1-MR2
- Réutilisation : pattern de `performance.tsx` (déjà implémenté)

### 3.3 Classement Top 10 provinces (histogramme horizontal)
- Axe Y : province, Axe X : valeur de l'indicateur
- Couleur conditionnelle : rouge (< seuil) / vert (≥ seuil)
- Tri : descendant (meilleures en haut)
- Composant : `Dhis2TrendBarChart` ou `Bar` (react-chartjs-2)

### 3.4 Tableau classement complet par province (pleine largeur)
- Colonnes : # | Province | Valeur | Statut | Barre de progression
- Badge : Satisfaisant / Attention / Critique
- Réutilisation : `performance.tsx` (déjà implémenté)

### 3.5 Analyse d'équité (2 cartes côte à côte)
- **Carte gauche** : Statistiques par indicateur (Min / Q1 / Médiane / Q3 / Max) + écart + ratio
- **Carte droite** : Niveau d'inégalité (Critique > 3x / Modérée 2-3x / Acceptable < 2x)
- Réutilisation : `equity.tsx` (déjà implémenté)

### 3.6 Comparatif meilleures vs pires provinces (tableau)
- Colonnes : Indicateur | Meilleure province | Valeur | Pire province | Valeur | Écart
- Réutilisation : `equity.tsx` (déjà implémenté)

### 3.7 Carte de risque par province (choroplèthe)
- Score de risque (0-100) coloré par province
- Légende : vert (faible) → rouge (critique)
- Réutilisation : logique de `risk-zones.tsx` + `Dhis2ChoroplethMap`

### 3.8 Tableau de risque détaillé (pleine largeur)
- Colonnes : # | Province | Score | Niveau | Penta3 | Dropout | BCG | Facteurs manquants
- Badge niveau : Faible / Modéré / Élevé / Critique
- Réutilisation : `risk-zones.tsx` (déjà implémenté)

### 3.9 Méthodologie (footer repliable)
- Formule du score + poids des facteurs + niveaux
- Réutilisation : bloc méthodologie de `risk-zones.tsx`

---

## Page 4 — Chaîne d'approvisionnement & Stock

**Objectif** : Sécuriser l'approvisionnement en vaccins et intrants.

> ⚠️ **Note données** : Les indicateurs logistiques (série B 6.1 DHIS2) ont leurs métadonnées présentes mais **0 lignes de données** actuellement dans DHIS2 SNIS RDC. Les composants doivent gérer élégamment l'absence de données (message "Données logistiques en cours de synchronisation") et être prêts à afficher les données dès qu'elles seront disponibles via l'ETL.

### 4.1 KPI Cards (4 cartes)
| KPI | Définition | Seuils |
|---|---|---|
| Taux de disponibilité des vaccins | % FOSA avec tous antigènes en stock | < 80% 🔴 / 80-95 🟠 / ≥ 95 🟢 |
| Taux de sites en rupture | % FOSA en rupture de stock (≥ 1 antigène) | > 10% 🔴 / 5-10 🟠 / ≤ 5 🟢 |
| Mois de stock moyens | Stock disponible / consommation mensuelle | < 1 mois 🔴 / 1-3 🟠 / 3-6 🟢 |
| Taux de surstock | % FOSA avec stock > 6 mois | > 20% 🔴 / 10-20 🟠 / ≤ 10 🟢 |

### 4.2 Évolution des ruptures de stock (courbe, pleine largeur)
- Axe X : mois (12 derniers), Axe Y : nombre de sites en rupture
- Lignes multiples : une par antigène (BCG, Penta, VAP, VAR, PCV13, ROTA)
- Composant : `Dhis2TrendChart` (multi-séries)

### 4.3 Répartition du statut de stock (donut, demi-largeur)
- Segments : Disponible | Rupture | Surstock | Péremption proche
- Composant : `Dhis2PieChart`

### 4.4 Niveau de stock par antigène (histogramme empilé, demi-largeur)
- Axe X : antigènes, Axe Y : mois de stock
- Empilement : stock national | stock provincial | stock ZS
- Composant : `Dhis2StackedBarChart`

### 4.5 Carte des ruptures de stock (choroplèthe, pleine largeur)
- Coloration : % de FOSA en rupture par province
- Légende : vert (≤ 5%) → rouge (> 10%)

### 4.6 Tableau détaillé stock par antigène et province
- Colonnes : Province | Antigène | Stock disponible | Mois de stock | Statut | Dernière mise à jour
- Tri : mois de stock ascendant (ruptures en haut)
- Badge : Rupture / Sous-minimum / Conforme / Surstock

### 4.7 Risques de péremption (tableau alerte)
- Colonnes : Antigène | Lot | Date péremption | Quantité | Statut
- Statut : Périmé / < 1 mois / 1-3 mois / > 3 mois
- Tri : date péremption ascendante

---

## Page 5 — Chaîne du froid & Équipements

**Objectif** : Surveiller l'intégrité de la chaîne du froid et l'état du parc d'équipements.

> ⚠️ **Note données** : Indicateurs chaîne du froid (série B 6.1) — métadonnées présentes, données à venir via ETL.

### 5.1 KPI Cards (4 cartes)
| KPI | Définition | Seuils |
|---|---|---|
| Taux de sites conformes température | % FOSA sans excursion de température | < 80% 🔴 / 80-95 🟠 / ≥ 95 🟢 |
| Excursions de température (mois) | Nombre d'excursions signalées | > 10 🔴 / 5-10 🟠 / ≤ 5 🟢 |
| Taux d'équipements fonctionnels | % réfrigérateurs opérationnels | < 85% 🔴 / 85-95 🟠 / ≥ 95 🟢 |
| Pannes signalées (mois) | Nombre d'équipements en panne | > 20 🔴 / 10-20 🟠 / ≤ 10 🟢 |

### 5.2 Évolution des excursions de température (courbe, pleine largeur)
- Axe X : mois, Axe Y : nombre d'excursions
- Lignes : températures hautes / températures basses
- Composant : `Dhis2TrendChart`

### 5.3 Répartition du statut des équipements (donut, demi-largeur)
- Segments : Fonctionnel | En panne | Maintenance préventive | Hors service
- Composant : `Dhis2PieChart`

### 5.4 Parc de réfrigérateurs par type (histogramme, demi-largeur)
- Axe X : type (réfrigérateur, congélateur, chambre froide), Axe Y : nombre
- Empilement : fonctionnel / en panne
- Composant : `Dhis2StackedBarChart`

### 5.5 Carte de conformité chaîne du froid (choroplèthe, pleine largeur)
- Coloration : % de sites conformes par province
- Légende : rouge (< 80%) → vert (≥ 95%)

### 5.6 Tableau détaillé équipements par province
- Colonnes : Province | Total équipements | Fonctionnels | En panne | Taux conformité | Dernière inspection
- Tri : taux conformité ascendant (provinces problématiques en haut)
- Badge : Conforme / À surveiller / Critique

### 5.7 Alertes pannes récentes (liste)
- Liste des 10 dernières pannes signalées
- Colonnes : FOSA | Province | Type équipement | Date panne | Statut réparation
- Badge : En cours / Réparé / Non traité

---

## Page 6 — Pertes, Consommation & Déchets

**Objectif** : Optimiser l'utilisation des vaccins et réduire les pertes.

### 6.1 KPI Cards (4 cartes)
| KPI | Indicateur DHIS2 | UID | Seuils |
|---|---|---|---|
| Taux de perte des vaccins | Taux de perte des vaccins | `YM7Tmn01ieL` | > 25% 🔴 / 15-25 🟠 / ≤ 5 🟢 |
| Doses Penta1 administrées | DTC-HepB Hib 1 doses | `uNdFg1eymsa` | (comptage) |
| Doses Penta3 administrées | DTC-HepB Hib 3 doses | `WWxqaHSeiwd` | (comptage) |
| Doses BCG administrées | BCG doses administrées | `W25tOXS0rxS` | (comptage) |

### 6.2 Évolution du taux de perte (courbe, pleine largeur)
- Axe X : mois (12 derniers), Axe Y : % de perte
- Ligne de seuil OMS (5% cible, 15% alerte, 25% critique)
- Composant : `Dhis2TrendChart`

### 6.3 Taux de perte par antigène (histogramme horizontal, demi-largeur)
- Axe Y : antigène, Axe X : % de perte
- Couleur conditionnelle selon seuil
- Composant : `Dhis2TrendBarChart`

### 6.4 Consommation de doses par antigène (histogramme empilé, demi-largeur)
- Axe X : mois, Axe Y : nombre de doses
- Empilement : BCG / Penta1 / Penta3 / VAP / VAR
- Composant : `Dhis2StackedBarChart`

### 6.5 Répartition des types de pertes (donut, demi-largeur)
- Segments : Flacons ouverts non utilisés | Péremption | Excursion température | Casses
- Composant : `Dhis2PieChart`

### 6.6 Tableau pertes par antigène et province
- Colonnes : Province | Antigène | Doses reçues | Doses administrées | Doses perdues | Taux de perte | Statut
- Tri : taux de perte descendant
- Badge : Conforme / À surveiller / Critique

### 6.7 Gestion des déchets de vaccination (tableau)
- Colonnes : Province | FOSA | Type déchet (DASRI, boîtes sécurité) | Quantité | Mode élimination
- Objectif : suivi de la traçabilité des déchets

---

## Page 7 — Qualité des données

**Objectif** : Évaluer la fiabilité des données rapportées au SNIS.

### 7.1 KPI Cards (4 cartes)
| KPI | Définition | Seuils |
|---|---|---|
| Taux de complétude des rapports | % FOSA ayant soumis le rapport mensuel | < 80% 🔴 / 80-95 🟠 / ≥ 95 🟢 |
| Taux de promptitude des rapports | % rapports reçus avant la date limite | < 70% 🔴 / 70-90 🟠 / ≥ 90 🟢 |
| Taux de concordance Penta3 | Cohérence entre doses administrées et couverture | < 80% 🔴 / 80-95 🟠 / ≥ 95 🟢 |
| Score DQA moyen | Score d'audit qualité des données | < 60 🔴 / 60-80 🟠 / ≥ 80 🟢 |

### 7.2 Évolution de la complétude et promptitude (courbe, pleine largeur)
- Axe X : mois, Axe Y : %
- Deux lignes : Complétude (bleu) + Promptitude (vert)
- Lignes de seuil : 95% (complétude cible), 90% (promptitude cible)
- Composant : `Dhis2TrendChart`

### 7.3 Complétude par province (histogramme horizontal, demi-largeur)
- Axe Y : province, Axe X : % complétude
- Couleur conditionnelle (< 80% rouge / 80-95 orange / ≥ 95 vert)
- Tri : ascendant (provinces les moins complètes en haut)
- Composant : `Dhis2TrendBarChart`

### 7.4 Répartition des scores DQA (donut, demi-largeur)
- Segments : Score ≥ 80 (conforme) / 60-80 (à améliorer) / < 60 (critique)
- Composant : `Dhis2PieChart`

### 7.5 Carte de complétude des rapports (choroplèthe, pleine largeur)
- Coloration : % complétude par province
- Légende : rouge (< 80%) → vert (≥ 95%)

### 7.6 Tableau de cohérence des indicateurs
- Colonnes : Province | Doses Penta3 déclarées | Couverture Penta3 calculée | Population cible | Concordance | Statut
- Détection de sur-déclaration / sous-déclaration
- Badge : Cohérent / Écart acceptable / Incohérent

### 7.7 Résultats DQA par zone de santé (tableau)
- Colonnes : Zone de santé | Province | Date audit | Score | Recommandations | Statut
- Tri : score ascendant (zones à risque en haut)

---

## Page 8 — Gestion PEV & Supervision

**Objectif** : Piloter l'exécution opérationnelle du programme.

> ⚠️ **Note données** : Indicateurs de gestion PEV (PAO, supervision) — à intégrer via ETL quand disponibles.

### 8.1 KPI Cards (4 cartes)
| KPI | Définition | Seuils |
|---|---|---|
| Taux d'exécution du PAO | % activités du plan annuel opérationnel réalisées | < 50% 🔴 / 50-80 🟠 / ≥ 80 🟢 |
| Taux de couverture supervisionision | % ZS supervisées sur la période | < 60% 🔴 / 60-80 🟠 / ≥ 80 🟢 |
| Taux de clôture des actions correctives | % actions correctives clôturées | < 50% 🔴 / 50-80 🟠 / ≥ 80 🟢 |
| Taux de réalisation des séances | % séances de vaccination réalisées vs planifiées | < 70% 🔴 / 70-90 🟠 / ≥ 90 🟢 |

### 8.2 Évolution de l'exécution du PAO (courbe, pleine largeur)
- Axe X : mois, Axe Y : % d'activités réalisées
- Ligne de cible : 80%
- Composant : `Dhis2TrendChart`

### 8.3 Répartition des types de séances (donut, demi-largeur)
- Segments : Séances fixes / Séances avancées / Séances mobiles / Campagnes
- Composant : `Dhis2PieChart`

### 8.4 Séances réalisées par province (histogramme empilé, demi-largeur)
- Axe X : province, Axe Y : nombre de séances
- Empilement : fixe / avancée / mobile
- Composant : `Dhis2StackedBarChart`

### 8.5 Carte de couverture de supervision (choroplèthe, pleine largeur)
- Coloration : % ZS supervisées par province
- Légende : rouge (< 60%) → vert (≥ 80%)

### 8.6 Tableau de suivi du PAO
- Colonnes : Activité | Province responsable | Date prévue | Date réalisée | Statut | Avancement %
- Tri : date prévue + statut
- Badge : Réalisé / En cours / En retard / Non démarré

### 8.7 Suivi des actions correctives (tableau)
- Colonnes : Action | Zone de santé | Issue de | Date ouverture | Date clôture | Statut
- Badge : Clôturée / En cours / En retard

### 8.8 Tableau des visites de supervision
- Colonnes : Province | ZS visitée | Date visite | Type (formative/évaluative) | Recommandations | Actions générées
- Tri : date descendante

---

## Page 9 — Surveillance MPV

**Objectif** : Surveiller les maladies évitables par la vaccination (MEV/MVP).

### 9.1 KPI Cards (4 cartes)
| KPI | Définition | Seuils OMS |
|---|---|---|
| Taux de notification PFA | Taux de détection paralysie flasque aiguë (cible ≥ 2/100 000 < 15 ans) | < 1 🔴 / 1-2 🟠 / ≥ 2 🟢 |
| Cas de rougeole signalés | Nombre de cas suspects/confirmés | (surveillance, pas de seuil fixe) |
| % cas PFA investigués < 48h | Promptitude des investigations PFA | < 80% 🔴 / 80-90 🟠 / ≥ 90 🟢 |
| % échantillons laboratoire résultats < 7j | Délai résultats laboratoire | < 70% 🔴 / 70-85 🟠 / ≥ 85 🟢 |

### 9.2 Évolution des cas PFA et rougeole (courbe, pleine largeur)
- Axe X : mois, Axe Y : nombre de cas
- Deux lignes : PFA (bleu) + Rougeole (rouge)
- Composant : `Dhis2TrendChart`

### 9.3 Répartition des cas par maladie (donut, demi-largeur)
- Segments : PFA / Rougeole / Fièvre jaune / Coqueluche / Tétanos néonatal / Autres MEV
- Composant : `Dhis2PieChart`

### 9.4 Notifications par province (histogramme empilé, demi-largeur)
- Axe X : province, Axe Y : nombre de cas
- Empilement : PFA / Rougeole / Fièvre jaune / Autres
- Composant : `Dhis2StackedBarChart`

### 9.5 Carte des cas de rougeole (choroplèthe, pleine largeur)
- Coloration : nombre de cas par province
- Légende : gradient jaune → rouge

### 9.6 Tableau de surveillance PFA
- Colonnes : Province | ZS | Cas PFA | Âge | Date investigation | Délai investigation | Échantillon prélevé | Résultat lab | Statut
- Tri : date investigation descendante
- Badge : Investigué < 48h / Investigé > 48h / Non investigué

### 9.7 Performance du réseau de laboratoires (tableau)
- Colonnes : Laboratoire | Province | Échantillons reçus | Échantillons testés | Délai moyen résultats | Taux conformité | Statut
- Badge : Conforme / À améliorer / Critique

### 9.8 Tableau de surveillance rougeole
- Colonnes : Province | Cas suspects | Cas confirmés | IgM+ | Taux confirmation | Taux notification | Statut
- Détection des foyers épidémiques

---

## Récapitulatif des composants par page

| Page | KPI Grid | Trend Chart | Bar Chart | Stacked Bar | Pie/Donut | Choropleth Map | Tableau | Composite |
|---|---|---|---|---|---|---|---|---|
| 1. Executive | ✅ 4 | — | — | — | — | ✅ | ✅ Top/Bottom + Alertes | ✅ Score |
| 3. Performance | ✅ 4 | — | ✅ Top 10 | — | — | ✅ Risque | ✅ Classement + Équité + Risque | ✅ Score risque |
| 4. Supply | ✅ 4 | ✅ Ruptures | — | ✅ Stock | ✅ Statut | ✅ Ruptures | ✅ Stock + Péremption | — |
| 5. Cold Chain | ✅ 4 | ✅ Excursions | — | ✅ Équipements | ✅ Statut | ✅ Conformité | ✅ Équipements + Pannes | — |
| 6. Wastage | ✅ 4 | ✅ Taux perte | ✅ Par antigène | ✅ Consommation | ✅ Types pertes | — | ✅ Pertes + Déchets | — |
| 7. Data Quality | ✅ 4 | ✅ Complétude | ✅ Par province | — | ✅ DQA | ✅ Complétude | ✅ Cohérence + DQA | — |
| 8. Management | ✅ 4 | ✅ PAO | — | ✅ Séances | ✅ Types séances | ✅ Supervision | ✅ PAO + Actions + Visites | — |
| 9. Surveillance | ✅ 4 | ✅ Cas PFA/Rougeole | — | ✅ Notifications | ✅ Maladies | ✅ Rougeole | ✅ PFA + Labo + Rougeole | — |

---

## Indicateurs DHIS2 disponibles (avec données réelles confirmées)

| Code | UID | Domaine | Page(s) |
|---|---|---|---|
| Couverture Penta1 | `k26tJ22Ncpd` | coverage | 1, 2, 3 |
| Couverture Penta3 | `v9b9aYsA5PM` | coverage | 1, 2, 3 |
| Couverture BCG | `cWJXYKCXrLx` | coverage | 1, 2, 3 |
| Couverture VAP4 | `tNZxs1kE6fy` | coverage | 1, 3 |
| Couverture VAP1 | `RZuHoUKI3fc` | coverage | 2 |
| Couverture PCV13-1 | `Dx7fV8rLg5F` | coverage | 2 |
| Couverture PCV13-3 | `biBItnhkMUe` | coverage | 2 |
| Couverture ROTA1 | `k8womY2OabA` | coverage | 2 |
| Couverture ROTA3 | `HX6kfUl1auv` | coverage | 2 |
| Couverture VPO3 | `PR35pwZEAny` | coverage | 2 |
| Couverture VPI1 | `F35ZsGcz2Lv` | coverage | 2 |
| Couverture VPI2 | `khtnBZ1Ispo` | coverage | 2 |
| Couverture VAR1 | `OKaDG2t6LtN` | coverage | 2 |
| Couverture VAA | `j2RPbYTGkAf` | coverage | 2 |
| Couverture Td2+ | `z4Iqy42FhNf` | coverage | 2 |
| Abandon Penta1-Penta3 | `MULXtL8iom8` | dropout | 1, 2, 3 |
| Abandon MR1-MR2 | `FhQ8Hd5rCHj` | dropout | 2, 3 |
| Taux de perte vaccins | `YM7Tmn01ieL` | wastage | 1, 6 |
| Enfants complètement vaccinés | `nvPe9ZZiEaH` | coverage | 1, 3 |
| Enfants sous-vaccinés | `RMHgIqfBG7N` | coverage | 1, 3 |
| BCG doses administrées | `W25tOXS0rxS` | coverage | 6 |
| Penta1 doses administrées | `uNdFg1eymsa` | coverage | 6 |
| Penta3 doses administrées | `WWxqaHSeiwd` | coverage | 6 |
| Enfants récupérés CAC-BCG | `hF8wVIOJrT8` | coverage | 2 |

> Les indicateurs logistiques (supply, coldchain), de gestion (management) et de surveillance spécifiques devront être intégrés via l'ETL quand les données seront disponibles dans DHIS2. Les composants sont conçus pour gérer l'absence de données avec un message clair.

---

## Prochaines étapes d'implémentation

1. **Mettre à jour `analytics-pages.ts`** : passer `available: true` pour chaque page au fur et à mesure
2. **Créer un composant de page par espace** (ex: `executive-page.tsx`, `performance-page.tsx`, etc.) suivant le pattern de `VisualizationGrid`
3. **Brancher dans `analytic-content.tsx`** : remplacer le rendu `ComingSoonPage` par le composant de page correspondant
4. **Compléter les i18n** (`fr.json` + `en.json`) : ajouter les libellés spécifiques à chaque page (titres de graphiques, en-têtes de tableaux, badges)
5. **Priorité** : Page 1 (Executive) et Page 3 (Performance) en premier — composants déjà existants (`ExecutiveOverview`, `Performance`, `Equity`, `RiskZones`) à réutiliser. Ensuite Page 6 (Wastage) qui a des données réelles. Les pages 4, 5, 7, 8, 9 suivront selon la disponibilité des données ETL.

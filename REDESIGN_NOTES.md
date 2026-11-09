# SIVAX — revue du projet et refonte visuelle

## 1. Résumé de la revue

L'archive contient une application web de pilotage vaccinal déjà structurée, basée sur Next.js 15, React 19 et TypeScript. Il ne s'agit pas uniquement d'un écran statique : le projet comporte une navigation authentifiée, plusieurs espaces analytiques, des appels API, un accès DHIS2/SNIS, une intégration Power BI, un Agent IA, des rapports, des alertes, des paramètres, ainsi qu'un backend FastAPI optionnel et des fichiers d'infrastructure.

La refonte a donc été réalisée en priorité dans les composants transversaux afin de moderniser toute l'expérience sans remplacer les connexions métier existantes ni introduire de résultats vaccinaux fictifs.

## 2. Revue par partie

| Partie | Éléments trouvés | Travail effectué / recommandation |
|---|---|---|
| Structure frontend | Next.js 15, React 19, TypeScript, Tailwind | Architecture conservée ; refonte dans les composants communs. |
| Navigation | Menu latéral, barre supérieure, recherche, profil et actions | Hauteur cohérente de 72 px, contrastes renforcés, éléments et libellés agrandis. |
| Accueil SIVAX | Ancien écran centré avec beaucoup d'espace vide | Nouvel accueil décisionnel, présentation plus forte, accès direct aux neuf espaces, partenaires conservés. |
| DHIS2 Analytics | Filtres, KPI, cartes, graphiques, tableaux et pages thématiques | Contrastes, dimensions, rayons, ombres, titres, légendes et graduations améliorés. |
| Espaces thématiques | Cibles, couverture, performance, stocks, chaîne du froid, pertes, qualité, gestion PEV et surveillance | Couleurs distinctives mais cohérentes avec la palette SIVAX. |
| Power BI | Conteneur dédié, mode rapport et plein écran | Barre d'outils et surface harmonisées ; intégration préservée. |
| Agent IA | Assistant global, panneau conversationnel et actions accessibles | Accès mis en avant depuis le nouvel accueil ; logique de l'assistant conservée. |
| Rapports, alertes, paramètres, aide | Routes et composants dédiés existants | Navigation et système global modernisés ; vérifier chaque parcours avec les comptes réels. |
| Données DHIS2 | Snapshot ETL/Supabase prioritaire, puis repli vers DHIS2 en direct selon le contexte | Stratégie conservée ; ne pas interpréter l'absence de donnée comme zéro. Vérifier la fraîcheur des synchronisations. |
| Backend et déploiement | Routes API Next.js, FastAPI optionnel, Docker et manifeste Render | Docker frontend conservé ; `render.yaml` décrit le backend FastAPI, pas l'application Next.js complète. |

## 3. Identité visuelle appliquée

- Bleu santé principal : `#174A8B` — navigation, actions principales et structure.
- Turquoise : `#13A89E` — couverture et éléments d'analyse.
- Vert : `#16A34A` — états favorables / succès.
- Orange : `#F59E0B` — vigilance.
- Rouge : `#DC2626` — criticité et pertes à investiguer.
- Violet : `#7C3AED` — fonctions IA et qualité / analyse spécialisée.
- Fond : `#F4F7FB`, cartes blanches, bordures discrètes.
- Typographie : Manrope avec fallback Inter et polices système ; taille de base 15 px.

Les états rouge, orange et vert sont des codes visuels, pas de nouveaux seuils épidémiologiques. Les seuils métier existants doivent rester validés par le PEV.

## 4. Améliorations livrées dans le code

- Accueil SIVAX transformé en tableau d'orientation métier : message explicite, accès à l'analyse et à l'Agent IA, aperçu du cycle de décision, accès aux neuf modules.
- Accès direct à chaque page thématique depuis l'accueil.
- Navigation latérale et barre supérieure plus hautes et plus lisibles.
- Titres principaux et titres de visualisation agrandis ; libellés, filtres, tableaux, axes et légendes renforcés.
- KPI plus visibles et cartes analytiques plus respirantes.
- Palette graphique harmonisée entre graphiques, cartes géographiques et indicateurs de statut.
- Hauteur de visualisation DHIS2 / Power BI améliorée et barre d'outils harmonisée.
- Métadonnées, manifeste PWA et libellés FR/EN adaptés à SIVAX.
- Documentation de refonte ajoutée et lien ajouté dans le README.
- Le comportement de récupération des données existant est conservé ; aucun total, taux ou résultat vaccinal n'a été inventé.

## 5. Sécurité du paquet

L'archive d'origine contenait un fichier d'environnement rempli avec des identifiants / clés. Ce fichier a été retiré de la version redistribuable. Les plans Terraform binaires contenant potentiellement des valeurs résolues ont également été retirés et le dossier `.git` ne sera pas livré dans l'archive de test.

**Action obligatoire avant déploiement :** renouveler les clés et mots de passe exposés dans l'archive initiale (notamment Supabase Service Role, fournisseurs IA / e-mail / notification et compte DHIS2). Configurer les nouvelles valeurs dans les variables d'environnement du service de déploiement ou dans un coffre de secrets. Ne pas copier les anciennes valeurs dans `.env.local`.

Le fichier `.env.example` fourni ne contient que des paramètres à compléter. Le secret Supabase Service Role et les clés privées doivent rester côté serveur uniquement.

## 6. Tester en local — Windows CMD

Prérequis : Node.js 22 recommandé et npm.

```bat
copy .env.example .env.local
notepad .env.local
npm ci
npm run dev
```

Compléter uniquement les variables nécessaires avec des identifiants nouvellement générés. Puis ouvrir `http://localhost:3000`.

Pour contrôler la version de production :

```bat
npm run lint
npm run build
npm start
```

Le backend FastAPI est optionnel pour certaines fonctions avancées de l'Agent IA. Le frontend Next.js possède déjà ses propres routes API.

## 7. Déploiement

- **Docker / Azure / Container Apps :** le `Dockerfile` racine construit et sert le frontend Next.js en mode standalone. Les variables `NEXT_PUBLIC_*` sont injectées à la phase de build ; les secrets serveur doivent être configurés au runtime / coffre de secrets.
- **Render :** le `render.yaml` du dépôt décrit uniquement le backend FastAPI. Il ne déploie pas à lui seul le frontend Next.js.
- **Vercel ou autre hébergeur Next.js :** relier le dépôt, configurer les variables d'environnement, utiliser `npm run build` et vérifier les domaines autorisés / CORS du backend.
- Avant production, valider le flux DHIS2 en lecture réelle, le compte / les rôles, les rapports Power BI, les fonctions IA, la synchronisation ETL et les dates de fraîcheur des données.

## 8. Contrôles réalisés dans cet environnement

- 221 fichiers TypeScript / TSX analysés par transpilation syntaxique : aucune erreur de syntaxe détectée. Ce contrôle n'est pas un `tsc --noEmit` et ne remplace pas la vérification des types / dépendances.
- Backend Python : compilation syntaxique réussie.
- 9 fichiers JSON : validation réussie.
- Recherche de motifs courants de secrets dans les fichiers texte hors `.git` : aucune correspondance restante détectée après nettoyage ; cela ne garantit pas l'absence absolue de secrets non reconnus.
- Installation npm et build Next.js complets : non validés ici. `npm ci` a échoué parce que le registre npm n'était pas joignable depuis l'environnement (`EAI_AGAIN`). Sur un poste connecté, lancer `npm ci`, puis `npm run lint` et `npm run build`.

Une version de test ne doit être déclarée prête à la production qu'après ces contrôles complets et les tests de connexion aux services réels.

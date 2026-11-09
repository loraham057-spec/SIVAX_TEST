# IMPLEMENTATION AUDIT — Power BI RDC Embedded + Agent IA

**Date :** 2026-08-19
**Référence :** `powerbi.md` (plan d'implémentation technique)
**Objectif :** État des lieux technique du repository avant implémentation.

---

## 1. Architecture actuelle

### Stack

| Couche | Technologie |
|---|---|
| Frontend | Next.js 15.5.21 (App Router), React 19, TypeScript 5.7 |
| UI | Tailwind CSS 3.4, Radix UI, Lucide icons, Framer Motion |
| Charts | Chart.js 4.5 + react-chartjs-2 |
| Maps | Leaflet 1.9 + react-leaflet 5 |
| State | Zustand 5 (stores) + React Context (providers) |
| Backend | Next.js API routes (primary), FastAPI optional (LangGraph) |
| DB | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth + custom RBAC (`src/lib/auth/`) |
| AI | OpenAI (tool calling) > Anthropic > FastAPI (LangGraph) |
| i18n | next-intl 3.26 |
| Notifications | Resend (email) + web-push |

### Structure du dashboard

```
/dashboard (page.tsx)
  ├── Tabs
  │   ├── "analytic" → AnalyticContent → PowerBIContainer(mode="analytic")
  │   │     ├── Sub-tab "welcome" → WelcomePage
  │   │     ├── Sub-tab "visualization" → Dhis2DataTable, Dhis2TrendChart,
  │   │     │                              Dhis2TrendBarChart, Dhis2ChoroplethMap
  │   │     └── AI analysis result → Dhis2AnalysisPanel / AnalysisRenderer
  │   │
  │   └── "powerbi" → PowerBIContainer(mode="powerbi")
  │         └── <iframe src={embedUrl}> (cross-origin, non contrôlable)
```

### Flux de données Analytics In-App

```
User prompt
  → /api/assistant/stream (ou /api/assistant)
  → ai.ts: generateAssistantResponse()
  → Priority: FastAPI (LangGraph) > OpenAI (tool calling) > Anthropic
  → Returns: { reply, commands: AgentCommand[], suggestions }
  → Client: agent-provider executeAll(commands)
  → Command "run_dhis2_analysis" → analysis-store.runAnalysis()
  → /api/dhis2/analysis → dhis2-analysis.ts
  → Supabase-first (fact_indicator_values) + DHIS2 fallback
  → AnalysisPayload (structured) → AnalysisRenderer
```

---

## 2. Architecture cible (Power BI Embedded)

```
/dashboard
  ├── Tab "analytic" (inchangé — DHIS2 natif)
  └── Tab "powerbi" → PowerBIContainer(mode="powerbi")
        ├── powerbi-client (remplace iframe)
        │   └── report instance (filters, pages, bookmarks, state)
        └── AI Panel (split view — interprétation + actions)
              └── Agent commands → powerbi_get_state, apply_filters, change_page, etc.

Backend:
  /api/powerbi/embed     (existant — embed token)
  /api/powerbi/query     (NOUVEAU — executeQueries DAX via REST)
  /api/powerbi/model     (NOUVEAU — métadonnées dataset via REST)
  /api/powerbi/refresh   (existant)
  /api/powerbi/export    (existant)

Abstraction:
  src/lib/powerbi/
    ├── types.ts         (PowerBIReportState, PowerBIAction, etc.)
    ├── intelligence.ts  (PowerBIIntelligence interface)
    ├── rest-adapter.ts  (implémentation REST executeQueries)
    ├── dax-gateway.ts   (validation, timeout, whitelist)
    └── ...
```

---

## 3. Fichiers concernés

### Fichiers existants à modifier

| Fichier | Rôle actuel | Changement prévu |
|---|---|---|
| `src/components/powerbi/powerbi-container.tsx` | iframe + toolbar + AI result overlay | Remplacer iframe par `powerbi-client`, exposer report instance, split view |
| `src/lib/powerbi.ts` | Auth Azure AD + embed token + refresh + export | Conserver, extraire dans `src/lib/powerbi/` (refactor modulaire) |
| `src/lib/agent/commands.ts` | Catalogue de commandes (navigate, settings, alerts, run_dhis2_analysis) | Ajouter commandes Power BI : `powerbi_get_state`, `powerbi_apply_filters`, `powerbi_change_page`, `powerbi_apply_bookmark`, `powerbi_clear_filters`, `powerbi_get_pages`, `powerbi_get_bookmarks`, `powerbi_query`, `powerbi_get_model` |
| `src/lib/agent/tools.ts` | Interfaces `PowerBITool` (applyFilters, changePage, export, refresh) | Étendre avec `get_model`, `query`, `get_state`, `get_pages`, `get_bookmarks`, `clear_filters`, `apply_bookmark` |
| `src/lib/ai.ts` | System prompt + tool calling OpenAI | Étendre le system prompt avec le contexte Power BI (pages, filtres, indicateurs PEV) |
| `src/app/(main)/dashboard/page.tsx` | Tabs analytic/powerbi | Passer `embedConfig` au PowerBIContainer, gérer le split view |
| `src/services/index.ts` | `powerbiService` (getEmbedConfig, exportReport, refreshReport) | Ajouter `queryDataset`, `getModel`, `getPages`, `getBookmarks` |
| `src/types/index.ts` | Types DHIS2 + AnalysisPayload | Ajouter types Power BI (PowerBIReportState, PowerBIAction, PowerBIFilter, etc.) |
| `src/lib/api-config.ts` | Routes API | Ajouter `powerbiQuery`, `powerbiModel` |
| `src/lib/settings.ts` | Settings definitions | Ajouter `powerbi_dataset_id` |
| `.env.example` | Variables d'env | Ajouter `POWERBI_DATASET_ID` |
| `supabase/migrations/` | Schéma existant | Nouvelle migration : `dim_date`, enrichissement `dim_indicators` |

### Fichiers existants à conserver inchangés

| Fichier | Raison |
|---|---|
| `src/lib/agent/agent-provider.tsx` | Système de commandes robuste — réutiliser `useRegisterCommand` |
| `src/lib/agent/policy-engine.ts` | Validation des commandes — étendre avec les nouvelles commandes |
| `src/store/analysis-store.tsx` | Store pour Analytics In-App — ne pas toucher |
| `src/store/assistant-store.tsx` | Store assistant — ne pas toucher |
| `src/components/analysis/` | Renderers AnalysisPayload — ne pas toucher |
| `src/components/dhis2/` | Composants DHIS2 natifs — ne pas toucher |
| `src/app/api/powerbi/embed/route.ts` | Fonctionne déjà — conserver |
| `src/app/api/powerbi/refresh/route.ts` | Fonctionne déjà — conserver |
| `src/app/api/powerbi/export/route.ts` | Fonctionne déjà — conserver |

### Fichiers nouveaux à créer

| Fichier | Rôle |
|---|---|
| `src/lib/powerbi/types.ts` | Types TypeScript Power BI (ReportState, Action, Filter, Query, etc.) |
| `src/lib/powerbi/intelligence.ts` | Interface `PowerBIIntelligence` (getModel, query) |
| `src/lib/powerbi/rest-adapter.ts` | Implémentation REST (executeQueries, getDataset, getTables) |
| `src/lib/powerbi/dax-gateway.ts` | Validation DAX (timeout, whitelist, row limit, read-only) |
| `src/lib/powerbi/embed-client.ts` | Logique `powerbi-client` (init, embed, report instance) |
| `src/lib/powerbi/filters.ts` | Helpers de filtres (validation, whitelist) |
| `src/lib/powerbi/pages.ts` | Helpers de navigation de pages |
| `src/lib/powerbi/bookmarks.ts` | Helpers de bookmarks |
| `src/lib/powerbi/state.ts` | Récupération de l'état courant du rapport |
| `src/lib/powerbi/cache.ts` | Cache des requêtes DAX et métadonnées |
| `src/lib/pev/indicators.ts` | Catalogue PEV (définitions, seuils, alias) |
| `src/lib/pev/definitions.ts` | Définitions opérationnelles PEV |
| `src/lib/pev/thresholds.ts` | Seuils PEV par indicateur |
| `src/lib/pev/aliases.ts` | Alias/synonymes pour la recherche d'indicateurs |
| `src/app/api/powerbi/query/route.ts` | API route POST executeQueries |
| `src/app/api/powerbi/model/route.ts` | API route GET métadonnées dataset |
| `src/components/powerbi/powerbi-embed.tsx` | Composant embed `powerbi-client` (remplace iframe) |
| `src/components/powerbi/ai-panel.tsx` | Panneau IA split view (interprétation + actions) |
| `src/store/powerbi-store.tsx` | Store Zustand pour l'état du rapport Power BI |
| `supabase/migrations/027_dim_date.sql` | Table `dim_date` (date, month, quarter, year, year_month) |

---

## 4. Dépendances existantes

### NPM (package.json)

| Package | Version | Utilisé pour | Pertinent Power BI ? |
|---|---|---|---|
| `next` | 15.5.21 | Framework | Oui (API routes) |
| `react` / `react-dom` | 19.0.1 | UI | Oui |
| `zustand` | 5.0.14 | State management | Oui (powerbi-store) |
| `chart.js` / `react-chartjs-2` | 4.5 / 5.3 | Charts natifs | Non (Power BI a ses propres visuels) |
| `leaflet` / `react-leaflet` | 1.9 / 5.0 | Maps natives | Non |
| `lucide-react` | 0.468 | Icons | Oui (toolbar) |
| `sonner` | 2.0.7 | Toasts | Oui (feedback actions) |
| `framer-motion` | 11.15 | Animations | Oui (split view) |
| `@radix-ui/*` | divers | UI primitives | Oui (tabs, dialog) |
| `react-markdown` / `remark-gfm` | 10.1 / 4.0 | Markdown rendering | Oui (AI panel) |

### À installer

| Package | Raison |
|---|---|
| `powerbi-client` | SDK JavaScript Power BI pour embed contrôlable |

> **Note :** `powerbi-client` est le seul package à installer. L'API REST
> `executeQueries` utilise `fetch` natif (déjà disponible). Pas de dépendance
> MCP, XMLA, ou SSAS.

---

## 5. Modèle de données Supabase actuel

### Tables existantes

```
dim_org_units
  id (text PK)           -- DHIS2 org unit UID
  name (text)
  level (int)            -- 1=national, 2=province, 3=ZS, 4=aire, 5=facility
  parent_id (text FK)
  province_id (text FK)  -- denormalized (migration 022)
  zone_id (text FK)      -- denormalized (migration 022)
  path (text)            -- materialized path (migration 022)
  created_at

dim_indicators
  id (text PK)           -- DHIS2 data element / indicator UID
  source (text)          -- 'dhis2', 'logistics', etc.
  label (text)
  unit (text)            -- 'count' | 'percent'
  category (text)        -- 'health'
  icon_key (text)
  domain (text)          -- 'vaccination', 'malaria', 'maternal' (migration 015)
  created_at

fact_indicator_values
  id (uuid PK)
  source (text)
  indicator_id (text FK)
  org_unit_id (text FK)
  period (text)          -- YYYYMM (monthly)
  value (numeric)
  synced_at (timestamptz)
  UNIQUE (source, indicator_id, org_unit_id, period)

etl_runs
  id, source, scope, status, rows_loaded, error, started_at, finished_at
```

### Vues existantes

| Vue | Description |
|---|---|
| `v_latest_kpi_values` | Dernière valeur par indicateur au niveau national + trend |
| `v_province_latest_values` | Dernière valeur par indicateur par province |
| `v_zones` | Zones de santé (level 3) avec province |
| `v_aires` | Aires de santé (level 4) avec zone + province |
| `v_org_unit_hierarchy` | Hiérarchie complète avec province/zone context |

### Indicateurs vaccinaux déjà seedés (migration 015)

| UID DHIS2 | Label | Unité | Domaine |
|---|---|---|---|
| `k26tJ22Ncpd` | Couverture Penta1 | percent | vaccination |
| `v9b9aYsA5PM` | Couverture Penta3 | percent | vaccination |
| `cWJXYKCXrLx` | Couverture BCG | percent | vaccination |
| `tNZxs1kE6fy` | Couverture VAP4 | percent | vaccination |
| `MULXtL8iom8` | Abandon Penta1-Penta3 | percent | vaccination |
| `FhQ8Hd5rCHj` | Abandon MR1-MR2 | percent | vaccination |
| `YM7Tmn01ieL` | Taux de perte vaccins | percent | vaccination |
| `nvPe9ZZiEaH` | Enfants complètement vaccinés | percent | vaccination |
| `RMHgIqfBG7N` | Enfants sous-vaccinés | count | vaccination |
| `W25tOXS0rxS` | BCG doses administrées | count | vaccination |
| `uNdFg1eymsa` | Penta1 doses administrées | count | vaccination |
| `WWxqaHSeiwd` | Penta3 doses administrées | count | vaccination |
| `hF8wVIOJrT8` | Enfants récupérés CAC-BCG | count | vaccination |

### Ce qui manque pour Power BI

1. **`dim_date`** — pas de dimension temporelle. Le period `YYYYMM` est une
   chaîne, pas une date. Power BI a besoin d'une vraie dimension date pour
   les hiérarchies temporelles (année > trimestre > mois).
2. **Attributs sémantiques sur `dim_indicators`** — pas d'antigène, dose,
   domaine PEV précis, seuils. La colonne `domain` existe mais est générique.
3. **Tables de faits séparées** — actuellement une seule `fact_indicator_values`
   pour tout. Pour Power BI, une fact table unique est acceptable si le modèle
   est en étoile avec `dim_indicators` + `dim_org_units` + `dim_date`.
4. **`dim_antigens`** (optionnel) — pour filtrer par antigène (BCG, Penta, VAR,
   etc.) au lieu de chercher dans le label de l'indicateur.

---

## 6. Système d'authentification Power BI actuel

### `src/lib/powerbi.ts`

```
getPowerBIEnv()
  → getSettings([powerbi_tenant_id, powerbi_client_id, powerbi_client_secret,
                 powerbi_workspace_id, powerbi_report_id])
  → PowerBIEnv

getAzureADToken()
  → POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  → client_credentials flow
  → scope: https://analysis.windows.net/powerbi/api/.default
  → access_token

getEmbedConfig(reportId?)
  → getAzureADToken()
  → GET /groups/{workspaceId}/reports/{reportId}  → embedUrl
  → POST /groups/{workspaceId}/reports/{reportId}/GenerateToken
  → { embedUrl, embedToken, reportId, expiresAt }

refreshDataset(reportId?)
  → GET report → datasetId
  → POST /groups/{workspaceId}/datasets/{datasetId}/refreshes

exportReport(reportId, format, pageName?)
  → POST /groups/{workspaceId}/reports/{reportId}/ExportTo
```

### Settings (src/lib/settings.ts)

Les credentials Power BI sont stockés dans `app_settings` (Supabase) avec
chiffrement AES pour les secrets. Les 5 settings existants :

- `powerbi_tenant_id` (non-secret)
- `powerbi_client_id` (non-secret)
- `powerbi_client_secret` (secret, chiffré)
- `powerbi_workspace_id` (non-secret)
- `powerbi_report_id` (non-secret)

**À ajouter :** `powerbi_dataset_id` (non-secret) — requis pour
`executeQueries`.

### Variables d'environnement (.env.example)

```env
POWERBI_TENANT_ID=
POWERBI_CLIENT_ID=
POWERBI_CLIENT_SECRET=
POWERBI_WORKSPACE_ID=
POWERBI_REPORT_ID=
```

**À ajouter :** `POWERBI_DATASET_ID=`

---

## 7. Système d'agent IA actuel

### Architecture

```
src/lib/ai.ts                    — generateAssistantResponse() (server)
  ├── callFastAPI()              — LangGraph backend (optional)
  ├── callOpenAI()               — OpenAI tool calling (primary)
  └── callAnthropic()            — Anthropic text (fallback)

src/lib/agent/commands.ts        — COMMANDS catalog (shared server/client)
  ├── navigate, open_assistant, close_assistant
  ├── set_theme, toggle_fullscreen, toggle_sidebar
  ├── logout, refresh
  ├── mark_all_notifications_read
  ├── filter_alerts, mark_all_alerts_read, mark_alert_read
  ├── switch_settings_tab, set_profile_field, save_profile, toggle_security
  ├── create_user, update_user_role, delete_user
  └── run_dhis2_analysis         — analyse DHIS2 (Analytics In-App)

src/lib/agent/agent-provider.tsx — AgentProvider (client)
  ├── register(commandId, handler)  — useRegisterCommand hook
  ├── execute(cmd)                   — validate + execute single command
  ├── executeAll(cmds)               — validate + execute multiple
  ├── needsConfirm(cmd)              — risk-based approval
  └── pendingApproval                — approval flow

src/lib/agent/policy-engine.ts   — validateCommand()
  ├── Schema validation
  ├── Authorization (role permissions)
  ├── Risk assessment (low/medium/high)
  └── Input sanitization

src/lib/agent/tools.ts           — Tool interfaces (PowerBITool, MLTool, etc.)
  └── PowerBITool: applyFilters, changePage, exportReport, refreshReport
      (interfaces seulement — pas d'implémentation)

src/lib/agent/audit.ts           — Audit log
src/lib/agent/conversations.ts   — Conversation memory
```

### System prompt (ai.ts)

Le system prompt actuel décrit :
- La plateforme SIVAX (DHIS2 RDC, 26 provinces, ~516 ZS)
- Les commandes disponibles (navigation, settings, alerts, users)
- `run_dhis2_analysis` pour les questions de données
- Les règles (répondre en français, ne pas inventer, utiliser l'historique)

**À étendre :** ajouter le contexte Power BI (pages disponibles, filtres
globaux, bookmarks, indicateurs PEV avec définitions et seuils).

### Commandes Power BI existantes

| Commande | Statut | Implémentation |
|---|---|---|
| `toggle_fullscreen` | ✅ Fonctionne | Enregistrée dans `PowerBIContainer` |
| `refresh` | ✅ Fonctionne (UI) | Provider — recharge la page |
| `run_dhis2_analysis` | ✅ Fonctionne | Enregistrée dans `analysis-store` |

### Commandes Power BI à ajouter

| Commande | Scope | Risk | Description |
|---|---|---|---|
| `powerbi_get_state` | registered | low | État courant (page, filtres, bookmarks) |
| `powerbi_get_pages` | registered | low | Liste des pages du rapport |
| `powerbi_get_bookmarks` | registered | low | Liste des bookmarks |
| `powerbi_change_page` | registered | low | Changer de page |
| `powerbi_apply_bookmark` | registered | low | Appliquer un bookmark |
| `powerbi_apply_filters` | registered | low | Appliquer des filtres (validés) |
| `powerbi_clear_filters` | registered | low | Effacer les filtres |
| `powerbi_query` | registered | low | Requête DAX via REST (gateway) |
| `powerbi_get_model` | registered | low | Métadonnées du modèle |

---

## 8. Limitation actuelle — iframe non contrôlable

### Problème

`PowerBIContainer` (mode "powerbi") render :

```tsx
<iframe
  src={embedUrl}
  className="h-full w-full border-0"
  title="Power BI Report"
  allowFullScreen
/>
```

L'iframe est cross-origin (app.powerbi.com). Le JavaScript de l'app ne peut
pas accéder au DOM de l'iframe, ni appeler des méthodes sur le rapport.

### Conséquences

- Impossible de changer de page programmatiquement
- Impossible d'appliquer/clear des filtres
- Impossible d'appliquer des bookmarks
- Impossible de récupérer l'état courant
- Impossible d'exporter une page spécifique
- L'agent IA ne peut pas piloter le rapport

### Solution

Remplacer l'iframe par `powerbi-client` (SDK JavaScript officiel) qui
initialise le rapport via l'API embed et expose une instance `report`
contrôlable :

```typescript
const report = await powerbi.embed(container, {
  type: "report",
  id: reportId,
  embedUrl,
  accessToken: embedToken,
  settings: { ... },
});

// Contrôle programmatique :
await report.setPage("Couverture vaccinale");
await report.setFilters(filters);
const state = await report.getFilters();
const pages = await report.getPages();
```

---

## 9. Risques identifiés

### Risques techniques

| Risque | Impact | Mitigation |
|---|---|---|
| `powerbi-client` non installé | Bloquant | `npm install powerbi-client` (Phase 5) |
| Embed token expire (1h) | Rapport devient inactif | Renouvellement automatique avant expiration |
| `executeQueries` rate limit (120/min) | Throttling IA | Cache DAX (section 41 du plan) |
| Dataset pas encore publié | Pas de rapport à embed | Phase 3-4 : construire et publier le .pbix |
| Service principal pas autorisé dans tenant | API REST échoue | Vérifier tenant settings (Phase 0 setup) |
| `POWERBI_DATASET_ID` non configuré | `executeQueries` échoue | Ajouter setting + .env |
| Cross-origin restrictions | Pas d'accès DOM iframe | `powerbi-client` résout ce problème |

### Risques de régression

| Risque | Mitigation |
|---|---|
| Modifier `PowerBIContainer` casse Analytics In-App | Le composant est partagé — tester les deux modes après modification |
| Ajouter des commandes casse le policy-engine | Les nouvelles commandes sont `scope: "registered"`, `risk: "low"` |
| Modifier `commands.ts` casse le schema OpenAI | `buildOpenAITools()` génère automatiquement — pas de risque |
| Modifier `ai.ts` system prompt change le comportement | Étendre, ne pas remplacer — conserver les règles existantes |

### Risques de données

| Risque | Mitigation |
|---|---|
| `dim_date` n'existe pas → Power BI ne peut pas faire de hiérarchie temporelle | Migration 027 (Phase 1) |
| Indicateurs PEV sans attributs (antigène, dose) → filtres Power BI limités | Enrichir `dim_indicators` (Phase 1) |
| Données logistiques (stock, chaîne froide) probablement absentes de DHIS2 | MVP sur couverture vaccinale uniquement (Phase 4) |

---

## 10. Changements nécessaires — ordre d'implémentation

### Phase 1 — Data Foundation (Supabase)

1. Créer `dim_date` (migration 027)
   - `date (date PK)`, `year (int)`, `quarter (int)`, `month (int)`,
     `month_name (text)`, `year_month (text YYYYMM)`, `year_quarter (text)`
   - Peupler de 2020-01-01 à 2027-12-01 (mensuel)
2. Enrichir `dim_indicators`
   - Ajouter colonnes : `antigen (text)`, `dose (text)`, `pev_domain (text)`
   - Mapper les 13 indicateurs vaccinaux existants
3. Ajouter `dim_date_id` à `fact_indicator_values` (FK vers dim_date)
   - Ou créer une vue qui joint `period` → `dim_date`

### Phase 2 — PEV Semantic Layer

1. Créer `src/lib/pev/indicators.ts`
   - Catalogue structuré : code, label, définition, domaine, unité,
     dimensions, seuils, alias, antigène, dose
2. Créer `src/lib/pev/thresholds.ts`
   - Seuils OMS/PEV par indicateur (low, warning, target)
3. Créer `src/lib/pev/aliases.ts`
   - Synonymes pour la recherche ("Penta3" → "Pentavalent 3", "VAP3", etc.)
4. Fonction `findIndicator(query: string)` — recherche fuzzy dans le catalogue

### Phase 3 — Power BI Model (.pbix)

1. Connecter Power BI Desktop à Supabase (PostgreSQL connector)
2. Importer `fact_indicator_values` + `dim_indicators` + `dim_org_units` + `dim_date`
3. Créer les relations (star schema)
4. Créer les mesures DAX :
   - `[Coverage Penta3 %]`, `[Coverage BCG %]`, `[Coverage VAR %]`
   - `[Penta1-Penta3 Dropout %]`
   - `[Zero Dose Rate %]`
   - `[Stockout Rate %]` (si données disponibles)
5. Publier dans le workspace Power BI Service

### Phase 4 — MVP Power BI (une page)

1. Page "Couverture vaccinale" :
   - KPI cards (Penta3, BCG, VAR, Dropout)
   - Courbe mensuelle
   - Bar chart par province
   - Carte RDC
   - Tableau par zone de santé
   - Slicers (Province, ZS, Antigène, Période)
2. Bookmarks : `bm_couverture_penta3`, `bm_couverture_var`
3. Publier et noter le `REPORT_ID` et `DATASET_ID`

### Phase 5 — Power BI Embedded (powerbi-client)

1. `npm install powerbi-client`
2. Créer `src/components/powerbi/powerbi-embed.tsx`
   - Initialise `powerbi.embed()` avec embedUrl + embedToken
   - Expose l'instance `report` via ref/callback
   - Gère le cleanup au démontage
3. Modifier `PowerBIContainer` (mode "powerbi")
   - Remplacer `<iframe>` par `<PowerBIEmbed>`
   - Conserver la toolbar existante
4. Créer `src/store/powerbi-store.tsx`
   - Zustand store : `reportInstance`, `reportState`, `setReport`, `updateState`

### Phase 6 — UI Tools (powerbi-client)

1. Enregistrer les commandes UI dans `PowerBIEmbed` via `useRegisterCommand` :
   - `powerbi_get_state` → `report.getFilters()` + `report.getActivePage()`
   - `powerbi_get_pages` → `report.getPages()`
   - `powerbi_get_bookmarks` → `report.bookmarks.getBookmarks()`
   - `powerbi_change_page` → `page.setActive()`
   - `powerbi_apply_bookmark` → `report.bookmarks.apply(name)`
   - `powerbi_apply_filters` → `report.setFilters(filters)` (validés)
   - `powerbi_clear_filters` → `report.removeFilters()`
2. Ajouter les commandes dans `commands.ts` (schema + speak)
3. Tester sans IA (console de test temporaire)

### Phase 7 — Data Tools (REST executeQueries)

1. Créer `src/app/api/powerbi/query/route.ts`
   - POST : reçoit `{ dax: string }`
   - Acquiert token Azure AD
   - Appelle `POST /datasets/{datasetId}/executeQueries`
   - Retourne `{ results: [...] }`
2. Créer `src/app/api/powerbi/model/route.ts`
   - GET : acquiert token, appelle `GET /datasets/{datasetId}` + `/tables`
   - Retourne `{ tables, measures (from PEV Layer), relationships }`
3. Créer `src/lib/powerbi/intelligence.ts` (interface)
4. Créer `src/lib/powerbi/rest-adapter.ts` (implémentation)
5. Enregistrer `powerbi_query` et `powerbi_get_model` dans `commands.ts`

### Phase 8 — DAX Gateway

1. Créer `src/lib/powerbi/dax-gateway.ts`
   - `validateDAX(query)` : read-only, whitelist tables, limit length
   - `executeDAX(query)` : timeout, row limit, logging, cache
2. Configurer `DAX_POLICY` (readOnly, maxRows, timeoutMs, maxQueryLength)
3. Tester requêtes valides et invalides

### Phase 9 — Agent tools branchés

1. Étendre le system prompt dans `ai.ts` :
   - Pages Power BI disponibles
   - Filtres globaux (Province, ZS, Antigène, Période)
   - Bookmarks disponibles
   - Indicateurs PEV (définitions, seuils, alias)
2. Ajouter `powerbi_*` commands au `buildOpenAITools()` (automatique via COMMANDS)
3. Tester : "Affiche la couverture Penta3 à Kinshasa en 2025"

### Phase 10 — Intent + Planning

1. Étendre la détection d'intent dans le system prompt ou le FastAPI backend
2. Catégories : FILTER, NAVIGATE, BOOKMARK, QUERY, EXPLAIN, COMPARE, EXPORT, HYBRID
3. Le planner doit pouvoir enchaîner : get_state → apply_filters → change_page → query → explain

### Phase 11 — Current Report State

1. `powerbi_get_state()` retourne `{ page, filters, bookmarks }`
2. Le contexte est injecté dans le prompt IA (system ou user message)
3. Permet : "Pourquoi cette province est-elle faible ?" → utilise le contexte courant

### Phase 12 — AI Panel (split view)

1. Créer `src/components/powerbi/ai-panel.tsx`
   - Panneau latéral rétractable
   - Historique de conversation
   - Actions exécutées (✓ Page changée, ✓ Filtre appliqué)
   - Résultats DAX (tableaux, KPI)
   - Interprétation IA (markdown)
2. Modifier `PowerBIContainer` (mode "powerbi") pour le split view
   - Layout : `flex` avec rapport Power BI | AI Panel
   - Panneau rétractable (framer-motion)

### Phase 13 — Tests

1. Tests fonctionnels (section 59 du plan)
2. Tests de robustesse (section 60)
3. Tests de sécurité (section 61)
4. Tests anti-hallucination (section 62)

---

## 11. Plan d'implémentation résumé

```
Phase 1  → dim_date + enrichissement dim_indicators (Supabase migration)
Phase 2  → PEV Semantic Layer (src/lib/pev/)
Phase 3  → Power BI Model (.pbix — mesures DAX, relations)
Phase 4  → MVP Page "Couverture vaccinale" (.pbix — 1 page)
Phase 5  → powerbi-client embed (remplace iframe)
Phase 6  → UI Tools (get_state, apply_filters, change_page, etc.)
Phase 7  → Data Tools (REST executeQueries + get_model)
Phase 8  → DAX Gateway (validation, timeout, whitelist)
Phase 9  → Agent tools branchés (system prompt + commands)
Phase 10 → Intent + Planning
Phase 11 → Current Report State (contexte IA)
Phase 12 → AI Panel (split view)
Phase 13 → Tests
```

**Vertical slice MVP :** Phases 1-9 sur la page "Couverture vaccinale"
uniquement. Valider de bout en bout (DHIS2 → Supabase → Power BI → Embed →
IA → Filtres → Interprétation) avant d'industrialiser les 8 autres pages.

---

## 12. État de préparation

| Prérequis | Statut | Action |
|---|---|---|
| Azure account | ✅ Existant | — |
| Entra tenant | ✅ Existant | — |
| Service principal (app registration) | ✅ Existant | Vérifier permissions API |
| Power BI Pro license (développeur) | ⚠️ À vérifier | Activer trial si nécessaire |
| Fabric Trial / capacity | ⚠️ À activer | Fabric Trial (gratuit 60j) ou A1 |
| Workspace sur capacity | ⚠️ À créer | Après activation capacity |
| Service principal dans workspace | ⚠️ À configurer | Admin/Contributor role |
| Tenant settings (service principal APIs) | ⚠️ À vérifier | Admin portal → Developer settings |
| `POWERBI_DATASET_ID` | ❌ Manquant | Ajouter après publication .pbix |
| `powerbi-client` npm | ❌ Non installé | Phase 5 |
| `dim_date` Supabase | ❌ Manquant | Phase 1 |
| PEV Semantic Layer | ❌ Manquant | Phase 2 |
| Rapport .pbix | ❌ Manquant | Phase 3-4 |

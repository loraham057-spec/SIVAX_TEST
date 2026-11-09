# DIAV1 — Documentation Technique

> **Version**: 2.0.0  
> **Dernière mise à jour**: Juillet 2026  
> **Statut**: Actif

---

## Table des matières

1. [Introduction](#1-introduction)
2. [Architecture Générale](#2-architecture-générale)
3. [Backend Principal — Next.js](#3-backend-principal--nextjs)
4. [Backend IA — FastAPI + LangGraph](#4-backend-ia--fastapi--langgraph)
5. [Authentification & Autorisation](#5-authentification--autorisation)
6. [Intégration DHIS2 (SNIS RDC)](#6-intégration-dhis2-snis-rdc)
7. [ETL — Pipeline DHIS2 → Supabase](#7-etl--pipeline-dhis2--supabase)
8. [Notifications (Push & Email)](#8-notifications-push--email)
9. [Speech-to-Text (ElevenLabs)](#9-speech-to-text-elevenlabs)
10. [API Reference](#10-api-reference)
11. [Sécurité](#11-sécurité)
12. [Configuration](#12-configuration)
13. [Frontend & UI](#13-frontend--ui)
14. [State Management](#14-state-management)
15. [PWA & Offline](#15-pwa--offline)
16. [Guide de Déploiement](#16-guide-de-déploiement)
17. [Contribuer](#17-contribuer)

---

## 1. Introduction

### 1.1 Objectif

DIAV1 est une plateforme d'analytics intelligente conçue pour les organisations gouvernementales, les ONG et les établissements de santé. Elle combine :

- **Tableaux de bord Power BI Embedded** — visualisation interactive de données de santé publique
- **Assistant IA (Decision Assistant)** — chat et voix en langage naturel avec pipeline LangGraph (intent → plan → tool → execute → verify → respond)
- **Données réelles DHIS2 (SNIS RDC)** — indicateurs de santé en temps réel depuis le SNIS de la RDC
- **ML Insights** — prévisions, détection d'anomalies et scoring prédictif
- **Notifications Push & Email** — alertes en temps réel via Web Push (VAPID) et Resend
- **Authentification Supabase** — gestion des utilisateurs avec RBAC (admin, analyst, viewer)
- **Alertes data-driven** — alertes stockées en base avec sévérité et types

### 1.2 Public cible

| Rôle | Cas d'usage |
|---|---|
| Ministère de la Santé | Suivi de la couverture vaccinale, gestion des stocks |
| ONG (OMS, UNICEF) | Analyse de partenariats, rapports d'impact |
| Établissements de santé | Surveillance épidémiologique, allocation de ressources |

### 1.3 Principes de conception

- **Architecture dual-backend** — Next.js (frontend + API REST) + FastAPI (agent IA LangGraph)
- **Sécurité par design** — toutes les clés API et tokens restent côté serveur, validation par policy engine
- **RBAC** — trois rôles (admin, analyst, viewer) avec permissions granulaires
- **Offline-first** — PWA avec service worker pour fonctionnement hors ligne
- **Agent IA sécurisé** — le LLM ne génère jamais de code, seulement des actions structurées validées

---

## 2. Architecture Générale

### 2.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                      Navigateur (Client)                      │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────┐ │
│  │ Dashboard │ │ Assistant│ │ Alerts │ │ Notif.   │ │ Auth │ │
│  │ + DHIS2   │ │ Drawer   │ │ Page   │ │ Page     │ │ Login│ │
│  └─────┬────┘ └─────┬────┘ └───┬────┘ └─────┬────┘ └──┬───┘ │
│        └────────────┴──────────┴─────────────┴─────────┘     │
│                         │                                     │
│          ┌──────────────▼──────────────┐                      │
│          │  AgentProvider + AuthProvider │                      │
│          │  (Context React — command exec) │                      │
│          └──────────────┬──────────────┘                      │
│                         │ fetch()                              │
┌─────────────────────────┼─────────────────────────────────────┐
│              Next.js API Routes (Serveur)                       │
│                         │                                      │
│  ┌──────────────────────▼────────────────────────────────────┐ │
│  │              Route Handlers (src/app/api/*)                │ │
│  │                                                             │ │
│  │  ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐ │ │
│  │  │/api/     │ │/api/   │ │/api/   │ │/api/users, alerts │ │ │
│  │  │assistant │ │powerbi │ │dhis2/  │ │push, notifications│ │ │
│  │  │+transcr. │ │(natif) │ │analytics│ │(Supabase)         │ │ │
│  │  └──────────┘ └────────┘ └────────┘ └──────────────────┘ │ │
│  │                                                             │ │
│  │  ┌─────────────────┐  ┌──────────────────────┐             │ │
│  │  │ /api/ml/*       │  │ Supabase (auth + DB) │             │ │
│  │  │ (→ FastAPI)     │  │ @supabase/ssr        │             │ │
│  │  └────────┬────────┘  └──────────────────────┘             │ │
│  └───────────┼──────────────────────────────────────────────┘ │
└──────────────┼────────────────────────────────────────────────┘
               │
     ┌─────────▼─────────┐
     │  FastAPI Backend   │
     │  (LangGraph Agent) │
     │  Port 8000         │
     │                    │
     │  • Intent Detection│
     │  • Planner (tools) │
     │  • Policy Engine   │
     │  • Tool Execution  │
     │  • Audit + Rate    │
     └────────────────────┘
```

### 2.2 Couches de l'application

| Couche | Répertoire | Responsabilité |
|---|---|---|
| **Pages/UI** | `src/app/*/page.tsx`, `src/components/` | Rendu React, interactions utilisateur |
| **Auth** | `src/lib/auth/auth-provider.tsx` | Context React pour l'authentification Supabase |
| **Agent** | `src/lib/agent/agent-provider.tsx` | Context React pour l'exécution des commandes IA |
| **API Routes** | `src/app/api/*/route.ts` | Handlers HTTP (backend Next.js) |
| **Server Libs** | `src/lib/ai.ts`, `src/lib/powerbi.ts`, `src/lib/dhis2.ts` | Logique serveur (LLM, Power BI, DHIS2) |
| **Email** | `src/lib/email/send.ts`, `templates.ts` | Notifications email via Resend |
| **Supabase** | `src/lib/supabase/` | Clients SSR, admin, browser |
| **Config** | `src/lib/api-config.ts` | Configuration multi-backend |
| **Types** | `src/types/index.ts` | Définitions TypeScript partagées |
| **FastAPI** | `backend/app/` | Agent IA LangGraph, policy engine, tools |

---

## 3. Backend Principal — Next.js

### 3.1 Rôle de Next.js dans l'architecture

Next.js 15 (App Router) gère à la fois le frontend et le backend REST dans une seule application :

- **API Route Handlers** — endpoints REST natifs (`src/app/api/*/route.ts`)
- **Server-side secrets** — variables d'environnement invisibles au client
- **Zero CORS issues** — frontend et backend partagent le même domaine
- **Supabase SSR** — authentification et base de données via `@supabase/ssr`
- **Edge-ready** — déploiement serverless possible

### 3.2 Modules natifs

#### AI Assistant (`src/lib/ai.ts`)

Orchestration LLM côté serveur avec fallback intelligent :

```
Utilisateur envoie un message
        ↓
generateAssistantResponse()
        ↓
1. Tentative OpenAI (si OPENAI_API_KEY configuré)
        ↓ échec
2. Tentative Anthropic (si ANTHROPIC_API_KEY configuré)
        ↓ échec
3. Fallback rule-based (réponses contextuelles prédéfinies)
```

**Points clés** :
- Le `SYSTEM_PROMPT` définit le persona de l'assistant
- Détection automatique des requêtes ML (`mlRequested`) via mots-clés
- Historique de conversation transmis pour le contexte
- Aucune clé API n'est jamais exposée au client

#### Power BI (`src/lib/powerbi.ts`)

Toutes les opérations Power BI sont gérées nativement via la REST API :

| Fonction | Endpoint Power BI | Flow |
|---|---|---|
| `getAzureADToken()` | `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | Client credentials flow |
| `getEmbedConfig()` | `api.powerbi.com/v1.0/myorg/groups/{ws}/reports/{id}` + `GenerateToken` | Récupère embedUrl + génère token |
| `refreshDataset()` | `api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{id}/refreshes` | Déclenche un refresh |
| `exportReport()` | `api.powerbi.com/v1.0/myorg/groups/{ws}/reports/{id}/ExportTo` | Export asynchrone PDF/PNG/PPTX |

**Sécurité** : Les credentials Azure AD (`POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`, `POWERBI_CLIENT_SECRET`) ne sont accessibles que côté serveur.

#### DHIS2 (`src/lib/dhis2.ts`)

Client HTTP server-side pour interroger l'API DHIS2 (SNIS RDC) en HTTP Basic auth :

| Fonction | Description |
|---|---|
| `isDhis2Configured()` | Vérifie que les credentials DHIS2 sont présents |
| `dhis2Get<T>(path)` | Requête GET bas niveau sur l'API DHIS2 |
| `fetchAnalytics({ dx, period, ou })` | Récupère une matrice de données pour des indicateurs donnés |

**Credentials** : `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD` (server-side uniquement).

#### Email (`src/lib/email/send.ts`, `templates.ts`)

Notifications email via Resend :

| Fonction | Description |
|---|---|
| `sendNotificationEmail()` | Envoie un email HTML à un destinataire |
| `sendBulkNotificationEmails()` | Envoie en masse (Promise.allSettled) avec rapport succès/échec |
| `buildEmailHtml()` | Génère le HTML à partir d'un template |

#### Supabase (`src/lib/supabase/`)

Trois clients Supabase selon le contexte :

| Client | Fichier | Usage |
|---|---|---|
| Server | `server.ts` | Server Components et Route Handlers (cookies SSR) |
| Browser | `browser.ts` | Client-side (auth, realtime) |
| Admin | `admin.ts` | Opérations admin (service_role key — création/suppression users) |

### 3.3 Routes API natives

| Route | Méthode | Handler | Source |
|---|---|---|---|
| `/api/assistant` | POST | `assistant/route.ts` | `lib/ai.ts` → `generateAssistantResponse()` |
| `/api/assistant/transcribe` | POST | `assistant/transcribe/route.ts` | ElevenLabs Speech-to-Text |
| `/api/powerbi/embed` | GET | `powerbi/embed/route.ts` | `lib/powerbi.ts` → `getEmbedConfig()` |
| `/api/powerbi/refresh` | POST | `powerbi/refresh/route.ts` | `lib/powerbi.ts` → `refreshDataset()` |
| `/api/powerbi/export` | POST | `powerbi/export/route.ts` | `lib/powerbi.ts` → `exportReport()` |
| `/api/dhis2/analytics` | GET | `dhis2/analytics/route.ts` | `lib/dhis2.ts` → `fetchAnalytics()` |
| `/api/kpis` | GET | `kpis/route.ts` | `lib/constants.ts` (données statiques) |
| `/api/activity` | GET | `activity/route.ts` | `lib/constants.ts` (données statiques) |
| `/api/alerts` | GET/PATCH | `alerts/route.ts` | Supabase (table `alerts`) |
| `/api/notifications` | GET/PATCH | `notifications/route.ts` | Supabase (table `notifications`) |
| `/api/users` | GET/POST | `users/route.ts` | Supabase admin (RBAC admin-only) |
| `/api/users/[id]` | PATCH/DELETE | `users/[id]/route.ts` | Supabase admin (RBAC admin-only) |
| `/api/push/subscribe` | POST/DELETE | `push/subscribe/route.ts` | Supabase (table `push_subscriptions`) |
| `/api/push/send` | POST | `push/send/route.ts` | Web Push (VAPID) + Email (Resend) |
| `/api/push/test-email` | POST | `push/test-email/route.ts` | Test email Resend |
| `/api/health` | GET | `health/route.ts` | Vérifie Next.js + satellites |

---

## 4. Backend IA — FastAPI + LangGraph

### 4.1 Vue d'ensemble

Le backend FastAPI (`backend/app/`) est l'orchestrateur de l'assistant IA. Il utilise **LangGraph** pour exécuter un pipeline structuré :

```
User Input
    ↓
Intent Detection (LLM classify)
    ↓
Planner (LLM + tool-calling → structured actions)
    ↓
Tool Selection (map actions → tool categories)
    ↓
Tool Execution (validate via policy → execute or flag)
    ↓
Result Verification (check failures)
    ↓
Response Generation (LLM → natural language)
    ↓
Conversation Memory (persist context)
```

**Règle critique** : Le LLM ne génère **jamais** de code, SQL ou commandes Power BI. Il produit uniquement des appels d'outils structurés (JSON) qui sont validés par le policy engine avant exécution.

### 4.2 Structure du backend

| Répertoire | Rôle |
|---|---|
| `backend/app/main.py` | Application FastAPI (CORS, middleware, routers) |
| `backend/app/agents/decision_assistant.py` | Agent LangGraph (6 nœuds, graph linéaire) |
| `backend/app/routers/agent.py` | POST `/api/agent/chat` — point d'entrée |
| `backend/app/routers/tools.py` | Appel direct aux tools (Power BI, ML, DB) |
| `backend/app/routers/health.py` | Health check FastAPI |
| `backend/app/policy.py` | Policy engine (validation, RBAC, sanitization) |
| `backend/app/tools/schema.py` | Catalogue de commandes (20+ commandes) |
| `backend/app/tools/registry.py` | Registry des tools (Power BI, ML, DB, Doc, Notif) |
| `backend/app/middleware/audit.py` | Audit logging (JSON structuré) |
| `backend/app/middleware/rate_limit.py` | Rate limiting (30 req/60s par IP) |
| `backend/app/core/config.py` | Configuration (env vars, Pydantic) |

### 4.3 Policy Engine (`backend/app/policy.py`)

Chaque action produite par le LLM passe par le policy engine :

1. **Validation de schéma** — vérifie les paramètres requis et leurs types
2. **Autorisation** — vérifie les permissions RBAC selon le rôle utilisateur
3. **Sanitization** — ne garde que les champs déclarés, trim les strings
4. **Évaluation du risque** — `low` (auto-exécuté), `medium`/`high` (needs approval)

**Détection d'injection de prompt** : `detect_prompt_input()` bloque les patterns suspects ("ignore previous instructions", "jailbreak", etc.).

### 4.4 Catalogue de commandes (`backend/app/tools/schema.py`)

| Commande | Catégorie | Risque | Permission |
|---|---|---|---|
| `navigate` | navigation | low | — |
| `open_assistant` / `close_assistant` | ui | low | `canViewAssistant` |
| `set_theme` | ui | low | — |
| `toggle_sidebar` | ui | low | — |
| `logout` | ui | high | — |
| `refresh` | ui | low | — |
| `mark_all_notifications_read` | notifications | low | — |
| `filter_alerts` | alerts | low | `canViewAlerts` |
| `mark_all_alerts_read` / `mark_alert_read` | alerts | low | `canViewAlerts` |
| `switch_settings_tab` | settings | low | `canViewSettings` |
| `set_profile_field` / `save_profile` | settings | medium | `canEditSettings` |
| `toggle_security` | settings | high | `canManageSecurity` |
| `create_user` | user_management | high | `canManageUsers` |
| `update_user_role` | user_management | high | `canManageUsers` |
| `delete_user` | user_management | high | `canManageUsers` |

### 4.5 Tools Registry (`backend/app/tools/registry.py`)

| Tool | Catégorie | Description |
|---|---|---|
| `PowerBITool` | powerbi | Embed, refresh, export |
| `MLTool` | ml | Forecast, anomaly detection |
| `DatabaseTool` | database | Requêtes base de données |
| `DocumentTool` | document | Génération/récupération de documents |
| `NotificationTool` | notification | Envoi de notifications |

**Allow-list par rôle** :
- **admin** : tous les tools
- **analyst** : powerbi, ml, database, document
- **viewer** : powerbi, database

### 4.6 Middleware

- **AuditMiddleware** — log JSON structuré pour chaque appel `/api/agent/*` (user, action, status, duration)
- **RateLimitMiddleware** — 30 requêtes / 60 secondes par IP sur `/api/agent/*`

### 4.7 Satellites optionnels (legacy)

L'architecture supporte toujours l'ajout de satellites optionnels (NestJS, Flask, etc.) via le système de proxy Next.js (`src/app/api/_lib/proxy.ts`). Voir la section 9.2 pour les routes proxy ML.

---

## 5. Authentification & Autorisation

### 5.1 Supabase Auth

L'authentification est gérée par **Supabase** via `@supabase/ssr` :

- **Login** : `src/app/(auth)/login/page.tsx` — page de connexion
- **Auth Provider** : `src/lib/auth/auth-provider.tsx` — Context React (session, user, signOut)
- **Supabase middleware** : `src/lib/supabase/middleware.ts` — refresh session sur chaque requête

### 5.2 RBAC (Role-Based Access Control)

Trois rôles avec permissions granulaires (`src/lib/auth/types.ts`) :

| Permission | admin | analyst | viewer |
|---|---|---|---|
| `canViewDashboard` | ✅ | ✅ | ✅ |
| `canViewAlerts` | ✅ | ✅ | ✅ |
| `canViewAssistant` | ✅ | ✅ | ✅ |
| `canViewDocumentation` | ✅ | ✅ | ✅ |
| `canViewSettings` | ✅ | ❌ | ❌ |
| `canManageUsers` | ✅ | ❌ | ❌ |
| `canEditSettings` | ✅ | ❌ | ❌ |
| `canManageApiKeys` | ✅ | ❌ | ❌ |
| `canManagePowerBI` | ✅ | ❌ | ❌ |
| `canManageSecurity` | ✅ | ❌ | ❌ |
| `canExportData` | ✅ | ✅ | ❌ |
| `canTriggerML` | ✅ | ✅ | ❌ |

### 5.3 Gestion des utilisateurs

- **`GET /api/users`** — liste tous les utilisateurs (admin only)
- **`POST /api/users`** — crée un utilisateur via Supabase admin (admin only)
- **`PATCH /api/users/[id]`** — modifie rôle/nom/organisation (admin only)
- **`DELETE /api/users/[id]`** — supprime utilisateur + profil (admin only)

### 5.4 Route protection

La fonction `canAccessRoute(role, pathname)` bloque l'accès aux routes protégées :
- `/settings` → requires `canViewSettings`
- `/assistant` → requires `canViewAssistant`

---

## 6. Intégration DHIS2 (SNIS RDC)

### 6.1 Vue d'ensemble

DIAV1 interroge l'API DHIS2 du **SNIS RDC** (`https://snisrdc.com`) pour récupérer des indicateurs de santé réels en temps réel.

### 6.2 Configuration

```env
DHIS2_BASE_URL=https://snisrdc.com
DHIS2_USERNAME=your-username
DHIS2_PASSWORD=your-password
# DHIS2_ROOT_OU=ymGeqzoPhN3  (optionnel, défaut: racine nationale RDC)
```

### 6.3 Route API

**`GET /api/dhis2/analytics`** — retourne des cartes statistiques pour le dashboard analytique :

- Récupère les 12 derniers mois de données pour des indicateurs curés
- Compare le dernier mois complet au précédent (delta %)
- Exclut les mois incomplets (mois courant + précédent)
- Formatage automatique (K, M, %)

**Indicateurs suivis** :

| ID DHIS2 | Label | Unité |
|---|---|---|
| `rOt4BctnRqS` | Cas de paludisme (présumés et confirmés) | count |
| `l5Gjya9Udz7` | Paludisme confirmé traité | count |
| `rPYLomUceL4` | Paludisme confirmé (microscopie/TDR) | count |
| `eVbOZqoI7JP` | Accouchements assistés par personnel qualifié | percent |

**Sécurité** : Les credentials DHIS2 restent côté serveur (HTTP Basic auth, jamais exposés au client).

---

## 7. ETL — Pipeline DHIS2 → Supabase

### 7.1 Vue d'ensemble

Le pipeline ETL (Extract, Transform, Load) synchronise les données DHIS2 vers Supabase de façon **planifiée** et **idempotente**. Cela permet :

- **Performance** : le dashboard lit depuis Supabase (~50ms) au lieu d'interroger DHIS2 à chaque requête (~5-15s)
- **Résilience** : si DHIS2 est indisponible, les données historisées restent disponibles
- **Historisation** : toutes les valeurs mensuelles sont conservées, permettant des analyses temporelles
- **Scalabilité** : conçu pour supporter 26 provinces, plusieurs indicateurs et d'autres sources futures

### 7.2 Architecture du pipeline

```
DHIS2 API (SNIS RDC)
    │
    ▼
[Extract]  backend/app/etl/sources/dhis2.py
    │   httpx + retry/backoff (3 tentatives)
    │   Exclut les mois incomplets (courant + précédent)
    ▼
[Transform] backend/app/etl/transforms.py
    │   Normalisation vers le schéma fact_indicator_values
    ▼
[Load]     backend/app/etl/loaders.py
    │   Upsert idempotent dans Supabase (batch 500)
    │   Contrainte unique: (source, indicator_id, org_unit_id, period)
    ▼
Supabase — fact_indicator_values
```

### 7.3 Schéma SQL (Supabase)

Migration : `supabase/migrations/001_etl_dhis2.sql`

| Table | Rôle |
|---|---|
| `dim_org_units` | Unités organisationnelles DHIS2 (national, province, zone de santé) |
| `dim_indicators` | Catalogue d'indicateurs (source, label, unité, catégorie) |
| `fact_indicator_values` | Table de faits : valeurs par indicateur × unité × période |
| `etl_runs` | Observabilité : statut, durée, lignes chargées pour chaque exécution |

### 7.4 Planification (APScheduler)

- **Sync quotidienne** à 03:00 UTC via APScheduler (`backend/app/etl/scheduler.py`)
- Démarrage/arrêt automatique via le lifespan FastAPI
- `misfire_grace_time = 3600s` (tolérance si le serveur démarre tard)

### 7.5 Endpoints API (FastAPI)

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/etl/sync` | Déclenche une sync manuelle (admin). Body: `{source, scope}` |
| `GET` | `/api/etl/status` | Retourne les 20 dernières exécutions ETL |

### 7.6 Lecture côté Next.js

La route `GET /api/dhis2/analytics` suit une stratégie **Supabase-first** :

1. **Supabase** : lit `fact_indicator_values` (instantané, cache 1h via `revalidate = 3600`)
2. **Fallback live** : si Supabase est vide, interroge directement DHIS2

La réponse inclut désormais un champ `series` (6 derniers mois) pour le graphique de tendance.

### 7.7 Ajouter une nouvelle source

1. Créer un extracteur dans `backend/app/etl/sources/`
2. Ajouter les métadonnées dans `dim_indicators` (source ≠ 'dhis2')
3. Appeler `run_pipeline()` depuis le scheduler ou l'endpoint

---

## 8. Notifications (Push & Email)

### 8.1 Web Push (VAPID)

Notifications push navigateur via la librairie `web-push` :

- **`POST /api/push/subscribe`** — enregistre une subscription push (Supabase `push_subscriptions`)
- **`DELETE /api/push/subscribe`** — désabonne
- **`POST /api/push/send`** — envoie push + email à tous les utilisateurs

**Configuration VAPID** :
```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
PUSH_INTERNAL_TOKEN=your-internal-push-token
```

Génération des clés : `npx web-push generate-vapid-keys`

### 8.2 Email (Resend)

Notifications email via **Resend** :

- **`POST /api/push/test-email`** — test d'envoi email
- `sendBulkNotificationEmails()` — envoi en masse avec `Promise.allSettled`
- Templates HTML personnalisés (`src/lib/email/templates.ts`)

**Configuration** :
```env
RESEND_API_KEY=re_your_key_here
```

### 8.3 Notifications en base

Les notifications sont stockées dans Supabase (table `notifications`) avec :
- `user_id`, `type`, `priority`, `title`, `body`, `summary`
- `icon`, `color`, `action_url`, `action_label`
- `source`, `metadata` (JSON), `push_status`, `push_sent_at`

---

## 9. Speech-to-Text (ElevenLabs)

### 9.1 Vue d'ensemble

L'assistant IA supporte la **saisie vocale** via l'API ElevenLabs Speech-to-Text (Scribe v1).

### 9.2 Route API

**`POST /api/assistant/transcribe`** :

- Reçoit un blob audio (`multipart/form-data`)
- Transmet à l'API ElevenLabs (`scribe_v1` model)
- Retourne `{ text: string }`

### 9.3 Configuration

```env
ELEVENLABS_API_KEY=your-elevenlabs-api-key
```

**Sécurité** : La clé API ElevenLabs reste côté serveur, jamais exposée au client.

---

## 10. API Reference

### 10.1 POST /api/assistant

Chat avec l'assistant IA.

**Request** :
```json
{
  "message": "Show provinces below 80% vaccination coverage",
  "history": [
    { "id": "msg-1", "role": "user", "content": "Hello", "timestamp": "..." },
    { "id": "msg-2", "role": "assistant", "content": "Hi! How can I help?", "timestamp": "..." }
  ],
  "context": {
    "reportId": "report-uuid",
    "filters": { "province": "Kinshasa" }
  }
}
```

**Response 200** :
```json
{
  "reply": "Here are the provinces below 80% coverage...",
  "mlRequested": false
}
```

**Response 400** :
```json
{ "error": "Missing 'message' field" }
```

### 10.2 GET /api/powerbi/embed

Génère un token d'embed Power BI.

**Query params** : `?reportId=<uuid>` (optionnel, fallback sur `POWERBI_REPORT_ID`)

**Response 200** :
```json
{
  "embedUrl": "https://app.powerbi.com/reportEmbed?reportId=...",
  "embedToken": "H4sIAAAAA...",
  "reportId": "uuid",
  "expiresAt": "2026-07-03T22:00:00Z"
}
```

### 10.3 POST /api/powerbi/refresh

Déclenche un refresh du dataset Power BI.

**Request** : `{ "reportId": "uuid" }`  
**Response 200** : `{ "status": "refresh_triggered" }`

### 10.4 POST /api/powerbi/export

Exporte un rapport Power BI.

**Request** :
```json
{
  "reportId": "uuid",
  "format": "PDF",
  "pageName": "ReportSection1"
}
```

**Response 200** : `{ "exportId": "export-uuid", "status": "Running" }`

### 10.5 GET /api/kpis

Retourne les cartes KPI du dashboard.

**Response 200** :
```json
[
  { "title": "Vaccination Coverage", "value": "87.3%", "change": "+2.1%", "trend": "up", "description": "National average this quarter" }
]
```

### 10.6 GET /api/activity

Retourne le flux d'activité récente.

### 10.7 GET /api/notifications

Retourne les notifications.

### 10.8 PATCH /api/notifications

Marque des notifications comme lues.

**Query** : `?id=<notificationId>` (single) ou aucun (all)

### 10.9 GET /api/health

Vérifie la santé du système.

**Response 200** :
```json
{
  "status": "ok",
  "backend": "nextjs",
  "satellites": {
    "nestjs": "online",
    "python": "offline"
  }
}
```

### 10.10 POST /api/ml/forecast (→ Python)

Proxy vers le backend Python ML.

**Request** : `{ "metric": "vaccination_coverage", "horizon": 30, "granularity": "daily" }`  
**Response** : `{ "forecast": [...], "confidence": 0.92, "summary": "..." }`

### 10.11 GET /api/ml/anomaly (→ Python)

Proxy vers le backend Python ML pour la détection d'anomalies.

---

## 11. Sécurité

### 11.1 Gestion des secrets

Tous les secrets sont stockés dans des variables d'environnement serveur et **ne sont jamais exposés au client** :

| Secret | Utilisation | Exposé au client ? |
|---|---|---|
| `OPENAI_API_KEY` | LLM (server-side) | Non |
| `ANTHROPIC_API_KEY` | LLM (server-side) | Non |
| `POWERBI_CLIENT_SECRET` | Azure AD token (server-side) | Non |
| `POWERBI_TENANT_ID` | Azure AD (server-side) | Non |
| `POWERBI_CLIENT_ID` | Azure AD (server-side) | Non |
| `RESEND_API_KEY` | Email (server-side) | Non |
| `ELEVENLABS_API_KEY` | Speech-to-Text (server-side) | Non |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin ops (server-side) | Non |
| `SUPABASE_JWT_SECRET` | JWT validation (server-side) | Non |
| `DHIS2_USERNAME` / `DHIS2_PASSWORD` | DHIS2 API (server-side) | Non |
| `VAPID_PRIVATE_KEY` | Web Push (server-side) | Non |

> Les variables préfixées par `NEXT_PUBLIC_` sont visibles côté client. Ne jamais y stocker de secrets.

### 11.2 Isolation CORS

Le frontend ne communique qu'avec les routes Next.js (même domaine). Les satellites sont appelés uniquement côté serveur, éliminant les problèmes CORS.

### 11.3 Policy Engine (FastAPI)

Le backend FastAPI valide chaque action IA via un policy engine :
- Validation de schéma, autorisation RBAC, sanitization
- Évaluation du risque (low/medium/high)
- Détection d'injection de prompt

### 11.4 Bonnes pratiques

- Utiliser `.env.local` (jamais committer de `.env` avec de vraies clés)
- Rotation régulière des clés API
- Restreindre les IP Azure AD app aux endpoints Power BI nécessaires
- Activer 2FA sur les comptes Azure et OpenAI

---

## 12. Configuration

### 12.1 Fichier `.env.local`

```env
# ── Supabase ──
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# ── OpenAI ──
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6-luna

# ── ElevenLabs (Speech-to-Text) ──
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# ── Power BI ──
POWERBI_WORKSPACE_ID=00000000-0000-0000-0000-000000000000
POWERBI_REPORT_ID=00000000-0000-0000-0000-000000000000
POWERBI_TENANT_ID=00000000-0000-0000-0000-000000000000
POWERBI_CLIENT_ID=00000000-0000-0000-0000-000000000000
POWERBI_CLIENT_SECRET=your-client-secret

# ── Email (Resend) ──
RESEND_API_KEY=re_your_key_here

# ── App ──
NEXT_PUBLIC_APP_NAME=DIAV1
NEXT_PUBLIC_APP_URL=https://your-domain.com

# ── Web Push (VAPID) ──
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
PUSH_INTERNAL_TOKEN=your-internal-push-token

# ── FastAPI Backend ──
FASTAPI_URL=http://localhost:8000
SUPABASE_JWT_SECRET=your-jwt-secret-here

# ── DHIS2 (SNIS RDC) ──
DHIS2_BASE_URL=https://snisrdc.com
DHIS2_USERNAME=your-dhis2-username
DHIS2_PASSWORD=your-dhis2-password
# DHIS2_ROOT_OU=ymGeqzoPhN3
```

### 12.2 Configuration Azure AD pour Power BI

1. Créer une App Registration dans Azure AD
2. Ajouter les permissions API : `PowerBI.Service` → `Tenant.Read.All`
3. Générer un client secret
4. Récupérer : Tenant ID, Client ID, Client Secret
5. Ajouter l'utilisateur/groupe au workspace Power BI avec accès "Viewer" minimum

### 12.3 Configuration Supabase

1. Créer un projet sur [supabase.com](https://supabase.com)
2. Récupérer : Project URL, anon key, service_role key
3. Créer les tables : `users`, `alerts`, `notifications`, `push_subscriptions`
4. Configurer les RLS policies selon le RBAC

### 12.4 Backend FastAPI

```bash
cd backend
python -m venv venv
source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 12.5 TypeScript

Le projet utilise TypeScript strict. Voir `tsconfig.json` pour la configuration.

---

## 13. Frontend & UI

### 13.1 Stack UI

| Technologie | Rôle |
|---|---|
| Tailwind CSS 3 | Styling utility-first |
| shadcn/ui | Composants accessibles (Radix UI primitives) |
| Framer Motion | Animations (transitions de page, drawer) |
| Lucide React | Icônes |
| next-themes | Dark / Light mode |
| sonner | Toasts et notifications |
| react-select | Sélecteurs avancés |

### 13.2 Composants principaux

| Composant | Path | Description |
|---|---|---|
| `AppShell` | `components/layout/app-shell.tsx` | Layout principal (TopNav + Sidebar + AssistantDrawer) |
| `TopNav` | `components/layout/top-nav.tsx` | Barre supérieure (menu, thème, profil) |
| `Sidebar` | `components/layout/sidebar.tsx` | Navigation latérale |
| `AssistantDrawer` | `components/assistant/assistant-drawer.tsx` | Panneau coulissant pour le chat IA |
| `PowerBIContainer` | `components/powerbi/powerbi-container.tsx` | Container pour l'embed Power BI |
| `ServiceWorkerRegister` | `components/pwa/sw-register.tsx` | Enregistrement du service worker PWA |

### 13.3 Pages

| Route | Page | Description |
|---|---|---|
| `/` | Login | Page de connexion (Supabase Auth) |
| `/dashboard` | Dashboard | KPIs, activité, Power BI, DHIS2 analytics |
| `/assistant` | AI Assistant | Page dédiée à l'assistant IA |
| `/alerts` | Alerts | Alertes data-driven avec filtres |
| `/notifications` | Notifications | Centre de notifications |
| `/settings` | Settings | Paramètres (profil, configurations, sécurité, users) |
| `/help` | Help | FAQ et support |
| `/documentation` | Documentation | Documentation technique in-app |
| `/offline` | Offline | Page hors ligne (PWA) |

---

## 14. State Management

### 14.1 Agent Provider (`src/lib/agent/agent-provider.tsx`)

Context React pour l'exécution des commandes IA côté client :

```typescript
interface AgentContextValue {
  register: (commandId: string, handler: CommandHandler) => () => void;
  execute: (cmd: AgentCommand) => Promise<string>;
  executeAll: (cmds: AgentCommand[]) => Promise<string[]>;
  needsConfirm: (cmd: AgentCommand) => boolean;
  pendingApproval: PendingApproval | null;
  resolveApproval: (approved: boolean) => void;
}
```

**Fonctionnalités** :
- Validation via policy engine côté client (`src/lib/agent/policy-engine.ts`)
- Rate limiting (15 commandes/minute)
- Détection d'injection de prompt
- Système d'approbation pour actions medium/high risk
- Handlers enregistrés par page pour commandes contextuelles
- Navigation automatique vers la page requise avant exécution

### 14.2 Auth Provider (`src/lib/auth/auth-provider.tsx`)

Context React pour l'authentification Supabase :

```typescript
interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}
```

### 14.3 Hooks personnalisés

| Hook | Fichier | Description |
|---|---|---|
| `useNotifications` | `src/lib/hooks/use-notifications.ts` | Gestion des notifications |
| `usePushSubscription` | `src/lib/hooks/use-push-subscription.ts` | Subscription Web Push |
| `useAppBadge` | `src/lib/hooks/use-app-badge.ts` | Badge de l'application (notifications non lues) |

---

## 15. PWA & Offline

### 15.1 Service Worker

- `public/sw.js` — Service worker pour le cache offline
- `public/manifest.json` — Manifest PWA (icônes, couleurs, nom)
- `src/components/pwa/sw-register.tsx` — Enregistrement automatique

### 15.2 Fonctionnalités PWA

- Installable sur mobile et desktop
- Fonctionnement hors ligne (cache des assets)
- Page `/offline` de fallback
- Notifications push natives

---

## 16. Guide de Déploiement

### 16.1 Build de production

```bash
# Frontend (Next.js)
npm run build
npm start

# Backend (FastAPI)
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 16.2 Variables d'environnement de production

Configurer toutes les variables requises sur la plateforme de déploiement :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `POWERBI_*` (5 variables)
- `ELEVENLABS_API_KEY`
- `RESEND_API_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_INTERNAL_TOKEN`
- `SUPABASE_JWT_SECRET`
- `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD`
- `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`

### 16.3 Déploiement Vercel (frontend)

```bash
vercel --prod
```

Next.js 15 est nativement supporté par Vercel (Edge / Serverless).

### 16.4 Déploiement FastAPI (backend)

Le backend FastAPI peut être déployé sur :
- **Render** / **Railway** / **Fly.io** — PaaS Python
- **Docker** — container avec `uvicorn`
- **VPS** — `uvicorn` derrière `nginx` + `certbot`

### 16.5 Déploiement Docker (frontend)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

---

## 17. Contribuer

### 17.1 Setup du projet

```bash
git clone <repo-url>
cd tbi_pfizer
npm install
cp .env.example .env.local
# Configurer .env.local avec vos clés

# Backend FastAPI
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Lancer le frontend
cd ..
npm run dev

# Lancer le backend (autre terminal)
cd backend
uvicorn app.main:app --reload --port 8000
```

### 17.2 Standards de code

- **TypeScript strict** — pas de `any` sans justification
- **ESLint + Prettier** — `npm run lint`
- **Python** — type hints, Pydantic models, docstrings
- **Conventions de nommage** :
  - Fichiers composants : `kebab-case.tsx`
  - Fonctions exportées : `camelCase`
  - Types/Interfaces : `PascalCase`
  - Constantes : `UPPER_SNAKE_CASE`
- **Commits** : utiliser des messages descriptifs (Conventional Commits recommandé)

### 17.3 Ajouter une nouvelle route API (Next.js)

1. Créer `src/app/api/<name>/route.ts`
2. Exporter `GET` / `POST` / `PATCH` / `DELETE` selon le besoin
3. Utiliser `apiError()` pour les erreurs standardisées
4. Si proxy vers un satellite, utiliser `proxyToNestJS()` ou `proxyToPython()`
5. Mettre à jour cette documentation

### 17.4 Ajouter une nouvelle commande IA (FastAPI)

1. Définir la commande dans `backend/app/tools/schema.py` (`COMMAND_CATALOG`)
2. Ajouter le handler côté client dans `src/lib/agent/commands.ts`
3. Si la commande est `provider` scope, ajouter le handler dans `agent-provider.tsx`
4. Si la commande est `registered` scope, enregistrer le handler dans la page concernée
5. Mettre à jour cette documentation

### 17.5 Ajouter une nouvelle page

1. Créer `src/app/(main)/<name>/page.tsx`
2. Ajouter l'entrée dans `NAV_ITEMS` (`src/components/layout/sidebar.tsx`)
3. Ajouter l'entrée dans `NAV_ITEMS` (`src/lib/constants.ts`)
4. Mettre à jour cette documentation

---

> **Note** : Cette documentation est mise à jour à chaque évolution du projet. La version in-app (`/documentation`) reflète toujours l'état courant du code.

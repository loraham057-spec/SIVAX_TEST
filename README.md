# SIVAX — AI-Powered Health Platform

> AI-powered health platform for government, NGOs, and healthcare organizations. Combines Power BI Embedded dashboards, an AI Agent (chat + voice + autonomous actions), DHIS2 analytics, ML-driven insights, and a vaccination-themed in-place analytics experience.

## Architecture Overview

**Next.js is the primary backend.** All API logic is handled natively by Next.js API Route Handlers — no separate backend server is required to run the application.

An optional **FastAPI / LangGraph** satellite backend provides advanced AI agent orchestration with multi-step planning, tool execution, verification, and fact-checking.

### What Next.js handles natively

| Feature | How |
|---|---|
| **AI Agent** | Server-side LLM orchestration (OpenAI / Anthropic) via `src/lib/ai.ts` with tool-calling, auto-correction loop, and SSE streaming |
| **AI Agent Streaming** | `POST /api/assistant/stream` — SSE events with real-time processing status |
| **Power BI Embed** | Azure AD client-credentials flow → Power BI REST API via `src/lib/powerbi.ts` |
| **Power BI Refresh** | Native dataset refresh via Power BI REST API |
| **Power BI Export** | Native report export (PDF/PNG/PPTX) via Power BI REST API |
| **DHIS2 Analytics** | Native DHIS2 API proxy — org units, data sets, data values, analytics, analysis |
| **Auth** | Supabase Auth (`@supabase/ssr`) — login, reset password, update password, session management |
| **Email** | Resend branded transactional emails (password reset, welcome, notifications) |
| **Push Notifications** | Web Push API with VAPID keys |
| **KPIs / Activity / Notifications** | Static data returned natively (ready for DB integration) |
| **Health Check** | Reports Next.js status + optional satellite backend status |

### Optional satellite backends

The architecture is designed to be **extensible**. Satellite backends can be added for specific needs without changing the frontend:

| Backend | Role | URL Env Var | Use Cases |
|---|---|---|---|
| **FastAPI / LangGraph** | AI agent orchestration | `FASTAPI_URL` | Multi-step planning, tool execution, verification, fact-checking, SSE status streaming |
| **NestJS** | Enterprise business logic | `NESTJS_BACKEND_URL` | Complex CRUD, data management, user/auth workflows |

> The frontend never calls satellite backends directly — all requests go through Next.js API routes for CORS isolation, secret management, and centralized error handling.

## AI Agent Architecture

The SIVAX AI Agent is a full agent (not just a chatbot) that can:

- **Understand** user intent in French and English
- **Plan** multi-step actions via LangGraph nodes
- **Execute** structured commands (navigation, UI, settings, alerts, notifications, user management, DHIS2 analysis, Power BI, ML)
- **Self-correct** when tool calls fail (bounded retry loop with LLM feedback)
- **Verify** results against ground-truth data (DHIS2 fact-checking)
- **Request approval** for medium/high-risk actions
- **Stream** real-time processing status to the frontend

### Agent pipeline (LangGraph)

```
User Input
  → context_analysis        → status: "analyzing"
  → router
  ├── chat_responder        → status: "generating"
  ├── clarification         → status: "generating"
  └── planner               → status: "retrieving_context"
       → tool_execution     → status: "processing_data"
       → result_verification → status: "validating"
       ├── retry (bounded)  → back to planner
       └── response_generation → status: "generating"
            → fact_check    → status: "validating"
            → END
```

### Frontend agent components

| File | Role |
|---|---|
| `src/lib/ai.ts` | Server-side LLM orchestration (OpenAI → Anthropic → fallback) with tool-calling and execution feedback |
| `src/lib/ai-processing.ts` | AI processing status types (`AIProcessingStatus`, `AICompleteEvent`) |
| `src/lib/agent/commands.ts` | Command catalog, scopes, risk levels, permissions |
| `src/lib/agent/agent-provider.tsx` | Command registration, batch execution, approval flow, detailed execution results |
| `src/lib/agent/policy-engine.ts` | Validation, authorization, sanitization, rate limiting, prompt-injection detection |
| `src/lib/agent/tools.ts` | Tool type contracts (Power BI, ML, database, documents, notifications) |
| `src/components/agent/approval-modal.tsx` | Human-in-the-loop approval modal for medium/high-risk commands |
| `src/store/assistant-store.tsx` | SSE streaming, auto-correction loop, processing status state |
| `src/store/analysis-store.tsx` | DHIS2 analysis execution and in-container result display |
| `src/components/ui/health-loading-animation.tsx` | Vaccination-themed SVG loading animation with animated status text |

### AI Processing Status (SSE)

The frontend receives real-time functional status updates via Server-Sent Events:

```text
event: status    data: {"status":"analyzing"}
event: status    data: {"status":"retrieving_context"}
event: status    data: {"status":"processing_data"}
event: status    data: {"status":"validating"}
event: status    data: {"status":"generating"}
event: complete  data: {"reply":"...","commands":[...]}
```

Statuses are mapped from **real LangGraph nodes** when FastAPI is available, or from a minimal functional fallback sequence when only Next.js is available. The chain-of-thought is never exposed — only functional pipeline stages.

### Auto-correction loop

When a command fails, the frontend sends execution feedback to the LLM, which can correct arguments or choose a different approach. The loop is bounded (max 2 retries) and preserves all safety controls (validation, authorization, approval).

## In-Place Analytics Experience

AI analysis results are rendered **directly inside** the active DHIS2 Analytics In-App or Power BI Embedded Report container — the user never leaves the page. The vaccination-themed loading animation (SVG carton + syringe) displays animated status text while the pipeline processes.

## Project Structure

```
src/
├── app/                        # Next.js App Router (frontend + primary backend)
│   ├── api/                    # API Route Handlers
│   │   ├── _lib/
│   │   │   └── proxy.ts        # proxyToNestJS() + proxyToPython() + apiError()
│   │   ├── assistant/          # POST /api/assistant       → native LLM
│   │   │   └── stream/         # POST /api/assistant/stream → SSE streaming
│   │   ├── auth/               # Auth routes (reset-password, callback)
│   │   ├── powerbi/
│   │   │   ├── embed/          # GET  /api/powerbi/embed   → native (Azure AD)
│   │   │   ├── export/         # POST /api/powerbi/export  → native (REST API)
│   │   │   └── refresh/        # POST /api/powerbi/refresh → native (REST API)
│   │   ├── dhis2/              # DHIS2 proxy routes (analytics, org-units, data-sets, etc.)
│   │   ├── ml/
│   │   │   ├── forecast/       # POST /api/ml/forecast     → proxy to Python
│   │   │   └── anomaly/        # GET  /api/ml/anomaly      → proxy to Python
│   │   ├── push/               # Web push notifications
│   │   ├── users/              # User management API
│   │   ├── kpis/               # GET  /api/kpis            → native
│   │   ├── activity/           # GET  /api/activity        → native
│   │   ├── notifications/      # GET/PATCH /api/notifications → native
│   │   └── health/             # GET  /api/health          → native + satellite checks
│   ├── (auth)/                 # Auth pages (login, reset-password, update-password)
│   ├── (main)/                 # Authenticated pages (dashboard, alerts, settings, etc.)
│   ├── offline/                # /offline page (PWA)
│   ├── globals.css
│   ├── layout.tsx
│   └── middleware.ts           # Route protection + i18n cookie
│
├── components/                 # React UI components
│   ├── agent/                  # Approval modal for AI agent commands
│   ├── assistant/              # AI Agent drawer + voice input
│   ├── dhis2/                  # DHIS2 explorer, analysis panel, filter bar, charts
│   ├── layout/                 # AppShell, TopNav, Sidebar
│   ├── powerbi/                # Power BI embed container with in-place AI results
│   ├── pwa/                    # Service worker + install prompt
│   ├── theme/                  # Theme provider + toggle
│   └── ui/                     # shadcn/ui base components + health-loading-animation
│
├── services/                   # API client layer (frontend → Next.js API routes)
│   └── index.ts                # assistantService, powerbiService, dhis2Service, mlService, etc.
│
├── store/                      # Client state management
│   ├── assistant-store.tsx     # AI Agent context (SSE streaming, auto-correction, status)
│   └── analysis-store.tsx      # DHIS2 analysis context (in-container results)
│
├── lib/                        # Server-side + shared utilities
│   ├── ai.ts                   # LLM orchestration (OpenAI / Anthropic + fallback + feedback)
│   ├── ai-processing.ts        # AI processing status types
│   ├── agent/                  # Agent command catalog, policy engine, provider, tools
│   ├── powerbi.ts              # Power BI REST API (Azure AD token, embed, refresh, export)
│   ├── email/                  # Resend email templates and send logic
│   ├── i18n/                   # Internationalization (next-intl, FR/EN, no locale routing)
│   ├── supabase/               # Supabase clients (server, route handler, admin)
│   ├── api-config.ts           # Multi-backend config + apiFetch() helper
│   ├── settings.ts             # Encrypted app settings (Supabase + env fallback)
│   ├── constants.ts            # App constants + static fallback data
│   └── utils.ts                # cn() Tailwind class merge
│
└── types/                      # TypeScript type definitions
    └── index.ts
```

## Data Flow

```
Frontend Component
    ↓ calls
src/services/ (API client)
    ↓ fetch()
Next.js API Route (src/app/api/*)
    ↓ native handling OR proxy
    ├──→ Native   (LLM, SSE streaming, Power BI, DHIS2, Auth, Email, Push, KPIs, notifications)
    ├──→ FastAPI  (LangGraph agent orchestration, SSE status)   ← optional satellite
    └──→ NestJS   (enterprise CRUD, data management)            ← optional satellite
```

## Internationalization

The platform is fully bilingual (French / English) using `next-intl@3.26.5`:

- No locale routing — locale is persisted via cookie
- Language toggle in the navbar
- All UI strings, AI loading messages, agent statuses, and email templates are translated
- Time zone configured as `Africa/Kinshasa`

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `SUPABASE_JWT_SECRET` | Yes | Supabase JWT secret |
| `OPENAI_API_KEY` | No* | OpenAI API key for AI agent |
| `OPENAI_MODEL` | No | OpenAI model (default: `gpt-6-luna`) |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key for AI agent |
| `ANTHROPIC_MODEL` | No | Anthropic model |
| `FASTAPI_URL` | No | FastAPI/LangGraph backend URL (for advanced agent orchestration) |
| `POWERBI_TENANT_ID` | No** | Azure AD tenant ID |
| `POWERBI_CLIENT_ID` | No** | Azure AD app client ID |
| `POWERBI_CLIENT_SECRET` | No** | Azure AD app client secret |
| `POWERBI_WORKSPACE_ID` | No** | Power BI workspace ID |
| `POWERBI_REPORT_ID` | No** | Power BI report ID |
| `DHIS2_BASE_URL` | No*** | DHIS2 instance URL |
| `DHIS2_USERNAME` | No*** | DHIS2 username |
| `DHIS2_PASSWORD` | No*** | DHIS2 password |
| `DHIS2_ROOT_OU` | No*** | DHIS2 root organisation unit ID |
| `RESEND_API_KEY` | No | Resend email API key |
| `NEXT_PUBLIC_APP_NAME` | No | App name for branding (default: `SIVAX`) |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No**** | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | No**** | Web Push VAPID private key |
| `PUSH_INTERNAL_TOKEN` | No**** | Push service internal token |
| `NESTJS_BACKEND_URL` | No | NestJS satellite backend URL |

> \* At least one LLM key is required for full AI agent functionality. Without keys, a rule-based fallback is used.
> \*\* Required for Power BI embed/refresh/export features.
> \*\*\* Required for DHIS2 analytics features.
> \*\*\*\* Required for web push notifications.

## API Reference

### Native Next.js API Routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/assistant` | AI agent chat (LLM orchestration with execution feedback) |
| `POST` | `/api/assistant/stream` | AI agent chat with SSE streaming + real-time status |
| `GET` | `/api/powerbi/embed` | Generate Power BI embed token |
| `POST` | `/api/powerbi/export` | Export report (PDF/PNG/PPTX) |
| `POST` | `/api/powerbi/refresh` | Trigger dataset refresh |
| `POST` | `/api/dhis2/analytics` | DHIS2 analytics query |
| `POST` | `/api/dhis2/analysis` | DHIS2 natural-language analysis |
| `GET` | `/api/dhis2/org-units` | DHIS2 organisation units |
| `GET` | `/api/dhis2/data-sets` | DHIS2 data sets |
| `GET` | `/api/dhis2/system-info` | DHIS2 system info |
| `POST` | `/api/auth/reset-password` | Send password reset email |
| `GET` | `/api/users` | List users (admin only) |
| `POST` | `/api/push/subscribe` | Subscribe to web push |
| `POST` | `/api/push/send` | Send push notification |
| `GET` | `/api/kpis` | KPI dashboard cards |
| `GET` | `/api/activity` | Recent activity feed |
| `GET` | `/api/notifications` | Fetch notifications |
| `PATCH` | `/api/notifications` | Mark notification(s) as read |
| `GET` | `/api/settings/security-policy` | Get security policy |
| `GET` | `/api/health` | Health check (Next.js + satellites) |

### FastAPI / LangGraph Routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agent/chat` | LangGraph agent (non-streaming) |
| `POST` | `/api/agent/chat/stream` | LangGraph agent with SSE status streaming |
| `GET` | `/api/health` | Backend health check |

### Proxy Routes (→ Python satellite)

| Method | Route | Proxies To |
|---|---|---|
| `POST` | `/api/ml/forecast` | `PYTHON_BACKEND_URL/api/v1/ml/forecast` |
| `GET` | `/api/ml/anomaly` | `PYTHON_BACKEND_URL/api/v1/ml/anomaly` |

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env.local

# Start frontend dev server
npm run dev

# Start FastAPI backend (optional, for advanced agent orchestration)
cd backend
source ../.venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Build for production
npm run build

# Lint
npm run lint
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| Language | TypeScript 5.7 |
| UI | React 19, Tailwind CSS 3, shadcn/ui, Radix UI, React Select |
| Animation | Framer Motion |
| Icons | Lucide React |
| PWA | Service Worker, Web Manifest, Web Push |
| AI / LLM | OpenAI API, Anthropic API (server-side, tool-calling) |
| AI Agent | LangGraph (FastAPI), command catalog, policy engine, approval flow |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Database | Supabase (PostgreSQL) |
| Email | Resend (branded transactional emails) |
| BI | Power BI Embedded (Azure AD) |
| Health Data | DHIS2 (SNIS RDC) |
| i18n | next-intl 3.26 (FR/EN, cookie-based, no locale routing) |
| State | React Context (assistant store, analysis store) |

## Documentation

- **Refonte UI / test**: voir `REDESIGN_NOTES.md` pour le nouveau système visuel, les espaces analytiques et les étapes de test.

- **In-app**: Visit `/documentation` for the interactive technical documentation page.
- **Markdown**: See `documentation.md` for the full technical reference.

## License

Private — All rights reserved.

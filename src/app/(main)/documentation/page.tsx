"use client";

import { useState, useEffect } from "react";
import {
  BookOpen,
  Server,
  Shield,
  Settings,
  Code2,
  Layers,
  Palette,
  GitBranch,
  ChevronRight,
  Menu,
  X,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Mic,
  Bell,
  Database,
  Users,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "overview", label: "Vue d'ensemble", icon: BookOpen },
  { id: "architecture", label: "Architecture", icon: Layers },
  { id: "backend", label: "Backend Next.js", icon: Server },
  { id: "fastapi", label: "Backend IA (FastAPI)", icon: Code2 },
  { id: "auth", label: "Auth & RBAC", icon: Users },
  { id: "dhis2", label: "DHIS2 (SNIS RDC)", icon: Activity },
  { id: "etl", label: "ETL Pipeline", icon: Database },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "speech", label: "Speech-to-Text", icon: Mic },
  { id: "api", label: "API Reference", icon: Code2 },
  { id: "security", label: "Sécurité", icon: Shield },
  { id: "config", label: "Configuration", icon: Settings },
  { id: "frontend", label: "Frontend & UI", icon: Palette },
  { id: "deploy", label: "Déploiement", icon: GitBranch },
] as const;

const NATIVE_ROUTES = [
  { method: "POST", path: "/api/assistant", desc: "Chat avec l'assistant IA (LLM)" },
  { method: "POST", path: "/api/assistant/transcribe", desc: "Speech-to-Text (ElevenLabs)" },
  { method: "GET", path: "/api/powerbi/embed", desc: "Token d'embed Power BI" },
  { method: "POST", path: "/api/powerbi/export", desc: "Export rapport (PDF/PNG/PPTX)" },
  { method: "POST", path: "/api/powerbi/refresh", desc: "Refresh dataset Power BI" },
  { method: "POST", path: "/api/dhis2/page-data", desc: "Données des pages analytiques (snapshot ETL, fallback live)" },
  { method: "GET", path: "/api/dhis2/analytics", desc: "Données DHIS2 (Supabase-first, fallback live)" },
  { method: "GET", path: "/api/kpis", desc: "Cartes KPI du dashboard" },
  { method: "GET", path: "/api/activity", desc: "Flux d'activité récente" },
  { method: "GET", path: "/api/alerts", desc: "Alertes data-driven (Supabase)" },
  { method: "PATCH", path: "/api/alerts", desc: "Marquer alertes comme lues" },
  { method: "GET", path: "/api/notifications", desc: "Notifications (Supabase)" },
  { method: "PATCH", path: "/api/notifications", desc: "Marquer notifications comme lues" },
  { method: "GET", path: "/api/users", desc: "Liste utilisateurs (admin)" },
  { method: "POST", path: "/api/users", desc: "Créer utilisateur (admin)" },
  { method: "PATCH", path: "/api/users/[id]", desc: "Modifier utilisateur (admin)" },
  { method: "DELETE", path: "/api/users/[id]", desc: "Supprimer utilisateur (admin)" },
  { method: "POST", path: "/api/push/subscribe", desc: "Subscription Web Push" },
  { method: "DELETE", path: "/api/push/subscribe", desc: "Désabonnement Push" },
  { method: "POST", path: "/api/push/send", desc: "Envoyer Push + Email" },
  { method: "POST", path: "/api/push/test-email", desc: "Test email Resend" },
  { method: "GET", path: "/api/health", desc: "Health check (Next.js + satellites)" },
];

const PROXY_ROUTES = [
  { method: "POST", path: "/api/ml/forecast", proxy: "Python", desc: "Prévisions ML" },
  { method: "GET", path: "/api/ml/anomaly", proxy: "Python", desc: "Détection d'anomalies" },
  { method: "POST", path: "/api/agent/chat", proxy: "FastAPI", desc: "Chat avec agent LangGraph" },
  { method: "POST", path: "/api/etl/sync", proxy: "FastAPI", desc: "Sync ETL manuelle (admin)" },
  { method: "GET", path: "/api/etl/status", proxy: "FastAPI", desc: "Statut des runs ETL" },
];

const ENV_VARS = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, note: "URL du projet Supabase" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, note: "Clé anonyme Supabase" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, note: "Clé service_role Supabase (admin ops)" },
  { name: "OPENAI_API_KEY", required: false, note: "Clé API OpenAI pour l'assistant IA" },
  { name: "OPENAI_MODEL", required: false, note: "Modèle OpenAI principal (défaut: gpt-6-luna)" },
  { name: "OPENAI_MODEL_FAST", required: false, note: "Modèle des étapes internes de l'agent FastAPI (défaut: gpt-6-luna)" },
  { name: "ELEVENLABS_API_KEY", required: false, note: "Clé API ElevenLabs (Speech-to-Text)" },
  { name: "POWERBI_TENANT_ID", required: false, note: "Azure AD tenant ID" },
  { name: "POWERBI_CLIENT_ID", required: false, note: "Azure AD app client ID" },
  { name: "POWERBI_CLIENT_SECRET", required: false, note: "Azure AD app client secret" },
  { name: "POWERBI_WORKSPACE_ID", required: false, note: "Power BI workspace ID" },
  { name: "POWERBI_REPORT_ID", required: false, note: "Power BI report ID" },
  { name: "RESEND_API_KEY", required: false, note: "Clé API Resend (email)" },
  { name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", required: false, note: "Clé publique VAPID (Web Push)" },
  { name: "VAPID_PRIVATE_KEY", required: false, note: "Clé privée VAPID (Web Push)" },
  { name: "PUSH_INTERNAL_TOKEN", required: false, note: "Token interne pour push" },
  { name: "SUPABASE_JWT_SECRET", required: false, note: "Secret JWT Supabase (FastAPI)" },
  { name: "FASTAPI_URL", required: false, note: "URL du backend FastAPI" },
  { name: "DHIS2_BASE_URL", required: false, note: "URL DHIS2 (SNIS RDC)" },
  { name: "DHIS2_USERNAME", required: false, note: "Utilisateur DHIS2" },
  { name: "DHIS2_PASSWORD", required: false, note: "Mot de passe DHIS2" },
  { name: "NEXT_PUBLIC_APP_NAME", required: false, note: "Nom de l'app (défaut: SIVAX)" },
  { name: "NEXT_PUBLIC_APP_URL", required: false, note: "URL publique de l'app" },
];

const TECH_STACK = [
  { layer: "Framework", tech: "Next.js 15 (App Router)" },
  { layer: "Language", tech: "TypeScript 5.7" },
  { layer: "UI", tech: "React 19, Tailwind CSS 3, shadcn/ui, Radix UI" },
  { layer: "Animation", tech: "Framer Motion" },
  { layer: "Icons", tech: "Lucide React" },
  { layer: "PWA", tech: "Service Worker, Web Manifest" },
  { layer: "AI / LLM", tech: "OpenAI GPT-6 Luna (gpt-6-luna), Anthropic en secours (server-side)" },
  { layer: "Agent IA", tech: "FastAPI + LangGraph + LangChain OpenAI (Python)" },
  { layer: "Connaissances santé", tech: "Couche sémantique PEV RDC (corpus doc_sante, 45 documents)" },
  { layer: "BI", tech: "Power BI Embedded (Azure AD)" },
  { layer: "Auth", tech: "Supabase (@supabase/ssr)" },
  { layer: "Données santé", tech: "DHIS2 API (SNIS RDC) + ETL Supabase" },
  { layer: "Notifications", tech: "Web Push (VAPID) + Resend (email)" },
  { layer: "ETL", tech: "CLI Python + httpx, CronJobs Kubernetes (EKS)" },
  { layer: "Déploiement", tech: "AWS EKS, GitOps Flux, images ECR" },
  { layer: "Speech-to-Text", tech: "ElevenLabs Scribe v1" },
  { layer: "State", tech: "React Context (Agent + Auth providers)" },
];

function methodColor(method: string) {
  switch (method) {
    case "GET": return "bg-blue-500/10 text-blue-600 border-blue-500/20";
    case "POST": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    case "PATCH": return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    case "DELETE": return "bg-red-500/10 text-red-600 border-red-500/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export default function DocumentationPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );

    SECTIONS.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Mobile sidebar toggle */}
      <Button
        variant="outline"
        size="icon"
        className="fixed left-4 top-20 z-50 lg:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>

      {/* Sidebar navigation */}
      <aside
        className={cn(
          "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] w-64 border-r bg-card transition-transform duration-300 lg:sticky lg:top-16 lg:z-10 lg:h-[calc(100vh-4rem)] lg:shrink-0 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Documentation</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">SIVAX v2.0.0</p>
          </div>
          <ScrollArea className="flex-1">
            <nav className="space-y-1 px-3 py-4">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => scrollTo(section.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {section.label}
                    {isActive && <ChevronRight className="ml-auto h-3 w-3" />}
                  </button>
                );
              })}
            </nav>
          </ScrollArea>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="mb-2">v2.0.0</Badge>
              <Badge variant="outline" className="mb-2">Octobre 2026</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Documentation Technique</h1>
            <p className="mt-2 text-muted-foreground">
              Guide complet de l'architecture, des API et de la configuration de SIVAX.
            </p>
          </div>

          {/* Overview */}
          <Section id="overview" title="Vue d'ensemble" icon={BookOpen}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              SIVAX est une plateforme d'analytics intelligente pour les organisations gouvernementales,
              les ONG et les établissements de santé. Elle combine des tableaux de bord Power BI Embedded,
              un assistant IA (Decision Assistant avec LangGraph), des données réelles DHIS2 (SNIS RDC),
              des insights ML, des notifications Push & Email, et une authentification Supabase avec RBAC.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <InfoCard icon={Server} title="Backend" value="Next.js + FastAPI" desc="API REST + Agent IA" />
              <InfoCard icon={Database} title="Auth & DB" value="Supabase" desc="RBAC + SSR" />
              <InfoCard icon={Shield} title="Sécurité" value="Policy Engine" desc="Validation + RBAC" />
            </div>
            <div className="mt-6">
              <h4 className="mb-3 text-sm font-semibold">Stack Technique</h4>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Couche</th>
                      <th className="px-4 py-2 text-left font-medium">Technologie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TECH_STACK.map((item, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-4 py-2 font-medium">{item.layer}</td>
                        <td className="px-4 py-2 text-muted-foreground">{item.tech}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Architecture */}
          <Section id="architecture" title="Architecture" icon={Layers}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Architecture dual-backend : Next.js gère le frontend et l'API REST, FastAPI orchestre l'agent IA
              via LangGraph. Supabase gère l'authentification et la base de données. Les données de santé
              proviennent de DHIS2 (SNIS RDC).
            </p>
            <Card className="mt-4 bg-muted/30">
              <CardContent className="pt-4">
                <pre className="overflow-x-auto text-xs leading-relaxed text-muted-foreground">
{`Frontend (React 19)
    ↓ AgentProvider + AuthProvider
Next.js API Routes
    ├── Native  (LLM, Power BI, DHIS2, alerts, users, push)
    ├── Supabase (auth + DB: users, alerts, notifications)
    └── FastAPI (LangGraph agent, ML, tools)
           ↓
    Intent → Plan → Tool Selection → Execute → Verify → Respond`}
                </pre>
              </CardContent>
            </Card>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Le frontend ne communique qu'avec les routes Next.js (même domaine)" />
              <FeatureRow icon={CheckCircle2} text="CORS isolation — satellites appelés uniquement côté serveur" />
              <FeatureRow icon={CheckCircle2} text="Secrets serveur — jamais exposés au client" />
              <FeatureRow icon={CheckCircle2} text="Agent IA sécurisé — le LLM ne génère que des actions structurées validées" />
              <FeatureRow icon={CheckCircle2} text="RBAC — 3 rôles (admin, analyst, viewer) avec permissions granulaires" />
              <FeatureRow icon={CheckCircle2} text="Supabase Auth — gestion des utilisateurs avec sessions SSR" />
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Backend */}
          <Section id="backend" title="Backend Next.js" icon={Server}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Next.js 15 (App Router) gère frontend et backend dans une seule application.
              Les API Route Handlers permettent des endpoints REST natifs sans serveur externe.
            </p>
            <div className="mt-4 space-y-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">AI Assistant — src/lib/ai.ts</CardTitle>
                  <CardDescription className="text-xs">
                    Orchestration LLM côté serveur (OpenAI gpt-6-luna → Anthropic → fallback rule-based)
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Report Engine — src/lib/report-engine/</CardTitle>
                  <CardDescription className="text-xs">
                    Planification du rapport (planner.ts) et rédaction de la narration (analysis.ts) en JSON
                    via gpt-6-luna, avec repli heuristique si le LLM est indisponible
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Power BI — src/lib/powerbi.ts</CardTitle>
                  <CardDescription className="text-xs">
                    Azure AD token → Power BI REST API (embed, refresh, export)
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">DHIS2 — src/lib/dhis2.ts</CardTitle>
                  <CardDescription className="text-xs">
                    Client HTTP Basic auth vers SNIS RDC (fetchAnalytics, dhis2Get)
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Email — src/lib/email/send.ts</CardTitle>
                  <CardDescription className="text-xs">
                    sendNotificationEmail(), sendBulkNotificationEmails() via Resend
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Supabase — src/lib/supabase/</CardTitle>
                  <CardDescription className="text-xs">
                    Clients server (SSR), browser et admin (service_role)
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Proxy Utils — src/app/api/_lib/proxy.ts</CardTitle>
                  <CardDescription className="text-xs">
                    proxyToNestJS(), proxyToPython(), apiError() — helpers réutilisables
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* FastAPI Backend */}
          <Section id="fastapi" title="Backend IA — FastAPI + LangGraph" icon={Code2}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Le backend FastAPI (<code className="rounded bg-muted px-1 text-xs">backend/app/</code>) orchestre
              l'assistant IA via un pipeline LangGraph en 6 étapes. Le LLM ne génère jamais de code —
              uniquement des actions structurées validées par le policy engine.
            </p>
            <Card className="mt-4 bg-muted/30">
              <CardContent className="pt-4">
                <pre className="overflow-x-auto text-xs leading-relaxed text-muted-foreground">
{`POST /api/agent/chat
    ↓
Intent Detection   — classification (NAVIGATE, FILTER, ANALYZE…)
                     + contexte santé PEV RDC (sigles, formules, seuils)
    ↓
Planner            — LLM + tool-calling → actions structurées
    ↓
Tool Selection     — mapping actions → catégories de tools
    ↓
Tool Execution     — policy engine → execute / needs_approval
    ↓
Result Verification — vérification des échecs
    ↓
Response Generation — réponse en langage naturel`}
                </pre>
              </CardContent>
            </Card>
            <h4 className="mb-3 mt-6 text-sm font-semibold">Modèles LLM</h4>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Usage</th>
                    <th className="px-4 py-2 text-left font-medium">Variable</th>
                    <th className="px-4 py-2 text-left font-medium">Modèle</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { usage: "Assistant Next.js, rapports, réponse finale de l'agent", env: "OPENAI_MODEL", model: "gpt-6-luna" },
                    { usage: "Classification, clarification, vérification des faits", env: "OPENAI_MODEL_FAST", model: "gpt-6-luna" },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs">{row.usage}</td>
                      <td className="px-4 py-2 text-xs font-mono">{row.env}</td>
                      <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{row.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Migration gpt-4o / gpt-4o-mini → gpt-6-luna : OpenAI retire la série GPT-4o le 14 janvier 2027" />
              <FeatureRow icon={CheckCircle2} text="Appels en reasoning_effort « none » : requis par gpt-6-luna pour le tool-calling et une température personnalisée en Chat Completions" />
              <FeatureRow icon={CheckCircle2} text="Limite de sortie via max_completion_tokens (max_tokens est refusé par gpt-6-luna)" />
              <FeatureRow icon={CheckCircle2} text="Coût : 0,10 $ / 1M tokens en entrée et 0,50 $ / 1M en sortie (contre 0,15 $ / 0,60 $ pour gpt-4o-mini)" />
            </div>
            <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 pt-4">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-muted-foreground">
                  Un modèle saisi dans <strong>Paramètres → Intégrations</strong> est enregistré en base et remplace
                  {" "}<code className="rounded bg-muted px-1">OPENAI_MODEL</code> côté Next.js. Ne pas y saisir un modèle retiré.
                </p>
              </CardContent>
            </Card>
            <h4 className="mb-3 mt-6 text-sm font-semibold">Connaissances santé — backend/app/tools/semantic_layer.py</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              La couche sémantique relie le langage des utilisateurs aux indicateurs DHIS2 et embarque le vocabulaire
              opérationnel du PEV RDC, extrait du corpus <code className="rounded bg-muted px-1 text-xs">doc_sante</code>
              {" "}(45 documents : directives, fiches techniques, macroplans, briefings). À chaque question, l'agent détecte
              les sigles, campagnes, formules et seuils cités et les injecte dans le prompt de la réponse finale.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Référentiel</th>
                    <th className="px-4 py-2 text-center font-medium">Entrées</th>
                    <th className="px-4 py-2 text-left font-medium">Exemples</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Indicateurs DHIS2 (définitions, seuils)", count: 14, ex: "numérateur, dénominateur, règles d'interprétation" },
                    { name: "Terminologie et vaccins", count: 43, ex: "VPOb, nVPO2, VPI, Penta, MR, VAR, PCV-13, PFA, LQAS, zéro dose" },
                    { name: "Types de campagnes", count: 8, ex: "JNV, JLV, ripostes cVDPV1/cVDPV2, rattrapage et suivi VAR, VAT, fièvre jaune" },
                    { name: "Formules de calcul", count: 9, ex: "taux et facteur de perte, cible VPO 0-59 mois, taux d'abandon, couverture" },
                    { name: "Seuils opérationnels", count: 8, ex: "LQAS 80 % et 90 %, revaccination, ECM, perte à l'administration, VPO3" },
                    { name: "Populations spéciales", count: 9, ex: "nomades, miniers, pêcheurs, déplacés, frontaliers, écoles" },
                    { name: "Structure administrative", count: 6, ex: "national, province, antenne, zone de santé, aire de santé, centre de santé" },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs">{row.name}</td>
                      <td className="px-4 py-2 text-center text-xs">{row.count}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Sigles développés en toutes lettres dans la réponse (ex. VPOb → Vaccin antipoliomyélitique oral bivalent)" />
              <FeatureRow icon={CheckCircle2} text="Contexte de campagne : cible, vaccin, stratégie et durée (ex. JNV : 0-59 mois, 3 jours + ratissage)" />
              <FeatureRow icon={CheckCircle2} text="Seuils LQAS : une zone de santé passe à 80 % avec au plus 9 enfants manqués sur 60" />
              <FeatureRow icon={CheckCircle2} text="Contexte servant à l'interprétation uniquement : les chiffres restent ceux des données DHIS2" />
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Policy engine — validation de schéma, RBAC, sanitization, évaluation de risque" />
              <FeatureRow icon={CheckCircle2} text="20+ commandes cataloquées (navigation, alertes, settings, gestion utilisateurs)" />
              <FeatureRow icon={CheckCircle2} text="Actions medium/high risk → approbation utilisateur requise" />
              <FeatureRow icon={CheckCircle2} text="Détection d'injection de prompt (patterns suspects bloqués)" />
              <FeatureRow icon={CheckCircle2} text="Rate limiting — 30 requêtes / 60s par IP" />
              <FeatureRow icon={CheckCircle2} text="Audit logging — JSON structuré pour chaque appel agent" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Tools Registry</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PowerBITool, MLTool, DatabaseTool, DocumentTool, NotificationTool —
                    allow-list par rôle (admin: tous, analyst: 4, viewer: 2)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Lancement</h4>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">
                    uvicorn app.main:app --reload --port 8000
                  </code>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Auth & RBAC */}
          <Section id="auth" title="Authentification & RBAC" icon={Users}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              L'authentification est gérée par Supabase (<code className="rounded bg-muted px-1 text-xs">@supabase/ssr</code>).
              Trois rôles avec permissions granulaires contrôlent l'accès aux fonctionnalités.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Permission</th>
                    <th className="px-4 py-2 text-center font-medium">admin</th>
                    <th className="px-4 py-2 text-center font-medium">analyst</th>
                    <th className="px-4 py-2 text-center font-medium">viewer</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { perm: "Dashboard / Alertes / Assistant", a: true, an: true, v: true },
                    { perm: "Export de données", a: true, an: true, v: false },
                    { perm: "Déclencher ML", a: true, an: true, v: false },
                    { perm: "Settings / Users / Sécurité", a: true, an: false, v: false },
                    { perm: "API Keys / Power BI config", a: true, an: false, v: false },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs">{row.perm}</td>
                      <td className="px-4 py-2 text-center text-xs">{row.a ? "✅" : "❌"}</td>
                      <td className="px-4 py-2 text-center text-xs">{row.an ? "✅" : "❌"}</td>
                      <td className="px-4 py-2 text-center text-xs">{row.v ? "✅" : "❌"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Gestion des utilisateurs par l'admin (création, rôle, suppression) via /api/users" />
              <FeatureRow icon={CheckCircle2} text="Sessions SSR avec cookies sécurisés (middleware Supabase)" />
              <FeatureRow icon={CheckCircle2} text="Permissions mirrorées côté FastAPI (policy engine Python)" />
            </div>
          </Section>

          <Separator className="my-8" />

          {/* DHIS2 */}
          <Section id="dhis2" title="Intégration DHIS2 (SNIS RDC)" icon={Activity}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              SIVAX interroge l'API DHIS2 du SNIS RDC pour afficher des indicateurs de santé réels.
              La route <code className="rounded bg-muted px-1 text-xs">/api/dhis2/analytics</code> compare
              le dernier mois complet au précédent et calcule les deltas.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Indicateur</th>
                    <th className="px-4 py-2 text-left font-medium">Unité</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Cas de paludisme (présumés et confirmés)", unit: "count" },
                    { label: "Paludisme confirmé traité", unit: "count" },
                    { label: "Paludisme confirmé (microscopie/TDR)", unit: "count" },
                    { label: "Accouchements assistés par personnel qualifié", unit: "percent" },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs">{row.label}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Credentials DHIS2 côté serveur uniquement (HTTP Basic auth)" />
              <FeatureRow icon={CheckCircle2} text="Exclusion automatique des mois incomplets (reporting en cours)" />
              <FeatureRow icon={CheckCircle2} text="Formatage automatique des valeurs (K, M, %)" />
            </div>
          </Section>

          <Separator className="my-8" />

          {/* ETL Pipeline */}
          <Section id="etl" title="ETL — Pipeline DHIS2 → Supabase" icon={Database}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Le pipeline ETL synchronise les données DHIS2 vers Supabase de façon planifiée et idempotente.
              Les pages lisent le snapshot Supabase au lieu d'interroger SNIS RDC, dont les requêtes analytiques
              peuvent dépasser 60 s.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Extract</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1">backend/app/etl/sources/dhis2.py</code> — httpx + retry/backoff (3 tentatives), exclusion des mois incomplets
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Transform</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1">backend/app/etl/transforms.py</code> — normalisation vers le schéma <code className="rounded bg-muted px-1">fact_indicator_values</code>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Load</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1">backend/app/etl/loaders.py</code> — upsert idempotent par batch de 500, contrainte unique (source, indicator, org_unit, period)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Schedule</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1">python -m app.etl.cli --scope &lt;scope&gt;</code> — CronJobs Kubernetes en production
                    (<code className="rounded bg-muted px-1">infra/k8s/base/etl-cronjob.yaml</code>) ; APScheduler en local uniquement
                  </p>
                </CardContent>
              </Card>
            </div>
            <h4 className="mb-3 mt-6 text-sm font-semibold">Planification (scopes)</h4>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Scope</th>
                    <th className="px-4 py-2 text-left font-medium">Quand</th>
                    <th className="px-4 py-2 text-left font-medium">Contenu</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { scope: "incremental", when: "Mercredi 03:00 UTC", content: "3 derniers mois complets : indicateurs PEV (national, provinces, zones), pages thématiques (national, provinces), ruptures FOSA (tous niveaux)" },
                    { scope: "weekly", when: "Dimanche 04:00 UTC", content: "Même fenêtre + niveau zone des pages thématiques (alias full)" },
                    { scope: "annual", when: "Le 1er du mois, 08:00 UTC", content: "Agrégats annuels + données de population (page Cibles)" },
                    { scope: "history", when: "Manuel", content: "Mois plus anciens, une fenêtre par exécution (ETL_MONTHS / ETL_MONTHS_OFFSET)" },
                    { scope: "thematic", when: "Manuel", content: "Pages thématiques seules (rattrapage), fenêtre via ETL_MONTHS" },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs font-mono">{row.scope}</td>
                      <td className="px-4 py-2 text-xs">{row.when}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Table Supabase</th>
                    <th className="px-4 py-2 text-left font-medium">Rôle</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { table: "dim_org_units", role: "Unités organisationnelles (national, province, zone)" },
                    { table: "dim_indicators", role: "Catalogue d'indicateurs (source, label, unité)" },
                    { table: "fact_indicator_values", role: "Table de faits : valeurs par indicateur × unité × période" },
                    { table: "etl_runs", role: "Observabilité : statut, durée, lignes chargées" },
                  ].map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-xs font-mono">{row.table}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Pages analytiques servies par POST /api/dhis2/page-data (snapshot ETL : unité choisie + enfants directs), DHIS2 live en secours (une seule tentative)" />
              <FeatureRow icon={CheckCircle2} text="Requêtes découpées en fenêtres de ETL_PERIOD_WINDOW mois (défaut 6) : SNIS RDC coupe toute requête de plus de ~90 s" />
              <FeatureRow icon={CheckCircle2} text="Stock vaccins lu dans le dataset SIGL ESS 2025 ; ruptures FOSA = nombre de formations sanitaires avec au moins un jour de rupture" />
              <FeatureRow icon={CheckCircle2} text="Verrou anti-chevauchement ; un run bloqué plus de 3 h est marqué en échec ; alarme CloudWatch après 5 jours sans succès" />
              <FeatureRow icon={CheckCircle2} text="Sync manuelle via POST /api/etl/sync (admin)" />
              <FeatureRow icon={CheckCircle2} text="Observabilité via GET /api/etl/status (20 derniers runs)" />
              <FeatureRow icon={CheckCircle2} text="Architecture extensible : ajouter une source = nouveau extracteur dans sources/" />
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Notifications */}
          <Section id="notifications" title="Notifications (Push & Email)" icon={Bell}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Système de notifications multi-canal : Web Push (VAPID), email (Resend) et
              notifications in-app stockées dans Supabase.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Web Push</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    VAPID keys, subscriptions Supabase, nettoyage auto des endpoints expirés (410)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Email (Resend)</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Templates HTML, envoi en masse avec rapport succès/échec
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">In-app</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Table notifications Supabase, badge app, priorités et types
                  </p>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Speech-to-Text */}
          <Section id="speech" title="Speech-to-Text (ElevenLabs)" icon={Mic}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              L'assistant IA supporte la saisie vocale. L'audio est envoyé à
              {" "}<code className="rounded bg-muted px-1 text-xs">/api/assistant/transcribe</code> qui
              transmet à l'API ElevenLabs (modèle Scribe v1) et retourne le texte transcrit.
            </p>
            <div className="mt-4 space-y-2">
              <FeatureRow icon={CheckCircle2} text="Support multilingue (code langue optionnel)" />
              <FeatureRow icon={CheckCircle2} text="Clé API ElevenLabs côté serveur uniquement" />
              <FeatureRow icon={CheckCircle2} text="Format multipart/form-data (blob audio du navigateur)" />
            </div>
          </Section>

          <Separator className="my-8" />

          {/* API Reference */}
          <Section id="api" title="API Reference" icon={Code2}>
            <h4 className="mb-3 text-sm font-semibold">Routes Natives (Next.js)</h4>
            <div className="space-y-2">
              {NATIVE_ROUTES.map((route, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className={cn("rounded border px-2 py-0.5 text-xs font-mono font-semibold", methodColor(route.method))}>
                    {route.method}
                  </span>
                  <code className="flex-1 text-sm">{route.path}</code>
                  <span className="hidden text-xs text-muted-foreground sm:block">{route.desc}</span>
                </div>
              ))}
            </div>
            <h4 className="mb-3 mt-6 text-sm font-semibold">Routes Proxy (→ Satellites)</h4>
            <div className="space-y-2">
              {PROXY_ROUTES.map((route, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className={cn("rounded border px-2 py-0.5 text-xs font-mono font-semibold", methodColor(route.method))}>
                    {route.method}
                  </span>
                  <code className="flex-1 text-sm">{route.path}</code>
                  <Badge variant="outline" className="text-xs">{route.proxy}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:block">{route.desc}</span>
                </div>
              ))}
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Security */}
          <Section id="security" title="Sécurité" icon={Shield}>
            <div className="space-y-3">
              <FeatureRow icon={Shield} text="Toutes les clés API restent côté serveur (process.env)" />
              <FeatureRow icon={Shield} text="Aucune clé n'est jamais exposée au client (pas de NEXT_PUBLIC_ pour les secrets)" />
              <FeatureRow icon={Shield} text="Isolation CORS — frontend et backend sur le même domaine" />
              <FeatureRow icon={Shield} text="Azure AD client credentials flow pour Power BI" />
              <FeatureRow icon={Shield} text="Policy engine (FastAPI) — validation, RBAC, sanitization, risque" />
              <FeatureRow icon={Shield} text="Détection d'injection de prompt côté client et serveur" />
              <FeatureRow icon={Shield} text="Rate limiting — 15 cmd/min (client), 30 req/min (FastAPI)" />
              <FeatureRow icon={Shield} text="Audit logging JSON structuré sur les appels agent" />
            </div>
            <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 pt-4">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-muted-foreground">
                  Ne jamais préfixer une variable secrète avec <code className="rounded bg-muted px-1">NEXT_PUBLIC_</code>.
                  Ces variables sont visibles côté client.
                </p>
              </CardContent>
            </Card>
          </Section>

          <Separator className="my-8" />

          {/* Configuration */}
          <Section id="config" title="Configuration" icon={Settings}>
            <p className="text-sm text-muted-foreground">
              Copier <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env.example</code> vers
              {" "}<code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env.local</code> et configurer :
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Variable</th>
                    <th className="px-4 py-2 text-left font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENV_VARS.map((env, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2">
                        <code className="text-xs">{env.name}</code>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{env.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Frontend */}
          <Section id="frontend" title="Frontend & UI" icon={Palette}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Card>
                  <CardContent className="pt-4">
                    <h4 className="text-sm font-semibold">Tailwind CSS 3</h4>
                    <p className="mt-1 text-xs text-muted-foreground">Styling utility-first avec dark/light mode</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <h4 className="text-sm font-semibold">shadcn/ui + Radix</h4>
                    <p className="mt-1 text-xs text-muted-foreground">Composants accessibles et personnalisables</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <h4 className="text-sm font-semibold">Framer Motion</h4>
                    <p className="mt-1 text-xs text-muted-foreground">Animations fluides (transitions, drawer)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <h4 className="text-sm font-semibold">PWA</h4>
                    <p className="mt-1 text-xs text-muted-foreground">Installable, offline, service worker</p>
                  </CardContent>
                </Card>
              </div>
            </div>
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold">Pages</h4>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "AI Assistant", href: "/assistant" },
                  { label: "Reports", href: "/reports" },
                  { label: "Notifications", href: "/notifications" },
                  { label: "Settings", href: "/settings" },
                  { label: "Help", href: "/help" },
                  { label: "Documentation", href: "/documentation" },
                ].map((page) => (
                  <a key={page.href} href={page.href}>
                    <Badge variant="outline" className="cursor-pointer hover:bg-accent/10">
                      {page.label}
                    </Badge>
                  </a>
                ))}
              </div>
            </div>
          </Section>

          <Separator className="my-8" />

          {/* Deploy */}
          <Section id="deploy" title="Déploiement" icon={GitBranch}>
            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <pre className="overflow-x-auto text-xs leading-relaxed text-muted-foreground">
{`# Frontend (Next.js)
npm run build && npm start

# Backend IA (FastAPI)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Lint
npm run lint`}
                </pre>
              </CardContent>
            </Card>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">AWS EKS + Flux</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Branche = environnement : un push sur dev ou prod est réconcilié par Flux en moins de 2 minutes
                  </p>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">infra/k8s/overlays/&#123;dev,prod&#125;</code>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Images Docker</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Web : node:22-alpine — IA/ETL : python:3.12-slim, scan Trivy puis push ECR
                  </p>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">.github/workflows/deploy.yml</code>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-semibold">Promotion</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Un déploiement dev réussi ouvre une PR dev → prod ; rien ne part en prod sans ce merge
                  </p>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">prod : eu-central-1</code>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* Footer */}
          <div className="mt-12 border-t pt-6">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                SIVAX — Documentation Technique v2.0.0
              </p>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm">
                  Code source
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function InfoCard({
  icon: Icon,
  title,
  value,
  desc,
}: {
  icon: typeof Server;
  title: string;
  value: string;
  desc: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{title}</p>
        <p className="text-sm font-semibold">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function FeatureRow({ icon: Icon, text }: { icon: typeof CheckCircle2; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

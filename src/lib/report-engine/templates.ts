/**
 * Report Design System — design tokens per template.
 *
 * Components and renderers must consume these tokens; never hardcode
 * colors, fonts or sizes inside renderers.
 */

import type { ReportTemplateId } from "./types";

export interface ReportTheme {
  id: ReportTemplateId;
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    muted: string;
    background: string;
    surface: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    coverBackground: string;
    coverText: string;
    chartPalette: string[];
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    titleSize: string;
    h1Size: string;
    h2Size: string;
    h3Size: string;
    bodySize: string;
    captionSize: string;
  };
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string };
  layout: { pageWidth: string; margins: string };
}

const BASE_TYPOGRAPHY = {
  headingFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  titleSize: "30px",
  h1Size: "22px",
  h2Size: "17px",
  h3Size: "14px",
  bodySize: "12.5px",
  captionSize: "10.5px",
};

const BASE_SPACING = { xs: "4px", sm: "8px", md: "16px", lg: "28px", xl: "44px" };
const BASE_LAYOUT = { pageWidth: "820px", margins: "56px" };

export const REPORT_THEMES: Record<ReportTemplateId, ReportTheme> = {
  sivax: {
    id: "sivax",
    name: "SIVAX Corporate",
    description: "Style moderne santé-technologie, institutionnel et épuré.",
    colors: {
      primary: "#1d4ed8",
      secondary: "#0f172a",
      accent: "#0ea5e9",
      text: "#1e293b",
      muted: "#64748b",
      background: "#ffffff",
      surface: "#f8fafc",
      border: "#e2e8f0",
      success: "#16a34a",
      warning: "#d97706",
      danger: "#dc2626",
      coverBackground: "#0f172a",
      coverText: "#ffffff",
      chartPalette: ["#1d4ed8", "#0ea5e9", "#16a34a", "#d97706", "#7c3aed", "#dc2626"],
    },
    typography: BASE_TYPOGRAPHY,
    spacing: BASE_SPACING,
    layout: BASE_LAYOUT,
  },
  institutional: {
    id: "institutional",
    name: "Institutional",
    description: "Inspiré des rapports d'organisations internationales de santé.",
    colors: {
      primary: "#0e7490",
      secondary: "#134e4a",
      accent: "#13A89E",
      text: "#1f2937",
      muted: "#6b7280",
      background: "#ffffff",
      surface: "#f0fdfa",
      border: "#d1d5db",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
      coverBackground: "#0e7490",
      coverText: "#ffffff",
      chartPalette: ["#0e7490", "#13A89E", "#0369a1", "#65a30d", "#b45309", "#b91c1c"],
    },
    typography: { ...BASE_TYPOGRAPHY, headingFont: "Georgia, 'Times New Roman', serif" },
    spacing: BASE_SPACING,
    layout: BASE_LAYOUT,
  },
  development: {
    id: "development",
    name: "Development",
    description: "Inspiré des rapports des banques de développement.",
    colors: {
      primary: "#065f46",
      secondary: "#1c1917",
      accent: "#d97706",
      text: "#292524",
      muted: "#78716c",
      background: "#ffffff",
      surface: "#fafaf9",
      border: "#e7e5e4",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
      coverBackground: "#065f46",
      coverText: "#ffffff",
      chartPalette: ["#065f46", "#d97706", "#0369a1", "#78716c", "#7c2d12", "#4d7c0f"],
    },
    typography: { ...BASE_TYPOGRAPHY, headingFont: "Georgia, 'Times New Roman', serif" },
    spacing: BASE_SPACING,
    layout: BASE_LAYOUT,
  },
  consulting: {
    id: "consulting",
    name: "Consulting / Executive",
    description: "Titres analytiques, messages clés et conclusions fortes.",
    colors: {
      primary: "#111827",
      secondary: "#374151",
      accent: "#174A8B",
      text: "#111827",
      muted: "#6b7280",
      background: "#ffffff",
      surface: "#f9fafb",
      border: "#e5e7eb",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
      coverBackground: "#111827",
      coverText: "#ffffff",
      chartPalette: ["#111827", "#174A8B", "#9ca3af", "#15803d", "#b45309", "#b91c1c"],
    },
    typography: { ...BASE_TYPOGRAPHY, titleSize: "32px", h1Size: "24px" },
    spacing: BASE_SPACING,
    layout: BASE_LAYOUT,
  },
  government: {
    id: "government",
    name: "Government / Public Sector",
    description: "Style sobre pour institutions publiques.",
    colors: {
      primary: "#1e3a8a",
      secondary: "#312e81",
      accent: "#ca8a04",
      text: "#1f2937",
      muted: "#6b7280",
      background: "#ffffff",
      surface: "#eff6ff",
      border: "#dbeafe",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
      coverBackground: "#1e3a8a",
      coverText: "#ffffff",
      chartPalette: ["#1e3a8a", "#ca8a04", "#0369a1", "#15803d", "#6b7280", "#b91c1c"],
    },
    typography: { ...BASE_TYPOGRAPHY, headingFont: "Georgia, 'Times New Roman', serif" },
    spacing: BASE_SPACING,
    layout: BASE_LAYOUT,
  },
};

export function getReportTheme(template: string | undefined): ReportTheme {
  return REPORT_THEMES[(template as ReportTemplateId) ?? "sivax"] ?? REPORT_THEMES.sivax;
}

export const TEMPLATE_OPTIONS = Object.values(REPORT_THEMES).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
}));

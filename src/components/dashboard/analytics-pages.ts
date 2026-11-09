/**
 * Analytics pages registry — the 9 visualization pages of the
 * "DHIS2 Analytics In-App" tab (mirrors the future Power BI report pages).
 *
 * Each page groups a family of indicators. Titles, descriptions and key
 * indicator lists live in the i18n messages under `analyticsPages.pages.<id>`.
 * Only `available: true` pages have real chart content today; the others
 * render an elegant "coming soon" placeholder until they are built.
 */

import type { LucideIcon } from "lucide-react";
import {
  Users,
  Syringe,
  Scale,
  Boxes,
  ThermometerSnowflake,
  Recycle,
  DatabaseZap,
  ClipboardList,
  Radar,
} from "lucide-react";

export type AnalyticsPageId =
  | "cibles"
  | "coverage"
  | "performance"
  | "supply"
  | "coldchain"
  | "wastage"
  | "dataquality"
  | "management"
  | "surveillance";

export interface AnalyticsPageDef {
  id: AnalyticsPageId;
  icon: LucideIcon;
  /** Accent color classes for the page icon tile. */
  accent: string;
  /** True when the page has real chart content implemented. */
  available: boolean;
}

export const ANALYTICS_PAGES: AnalyticsPageDef[] = [
  { id: "cibles", icon: Users, accent: "bg-[#174A8B]/10 text-[#174A8B] dark:text-blue-300", available: true },
  { id: "coverage", icon: Syringe, accent: "bg-[#13A89E]/10 text-[#0F8C83] dark:text-teal-300", available: true },
  { id: "performance", icon: Scale, accent: "bg-[#16A34A]/10 text-[#15803D] dark:text-green-300", available: true },
  { id: "supply", icon: Boxes, accent: "bg-[#F59E0B]/10 text-[#B45309] dark:text-amber-300", available: true },
  { id: "coldchain", icon: ThermometerSnowflake, accent: "bg-[#0E7490]/10 text-[#0E7490] dark:text-cyan-300", available: true },
  { id: "wastage", icon: Recycle, accent: "bg-[#DC2626]/10 text-[#DC2626] dark:text-red-300", available: true },
  { id: "dataquality", icon: DatabaseZap, accent: "bg-[#7C3AED]/10 text-[#7C3AED] dark:text-violet-300", available: true },
  { id: "management", icon: ClipboardList, accent: "bg-[#4F46E5]/10 text-[#4F46E5] dark:text-indigo-300", available: true },
  { id: "surveillance", icon: Radar, accent: "bg-[#C2410C]/10 text-[#C2410C] dark:text-orange-300", available: true },
];

export const DEFAULT_ANALYTICS_PAGE: AnalyticsPageId = "coverage";

export function getAnalyticsPage(id: AnalyticsPageId): AnalyticsPageDef {
  return ANALYTICS_PAGES.find((p) => p.id === id) ?? ANALYTICS_PAGES[1];
}

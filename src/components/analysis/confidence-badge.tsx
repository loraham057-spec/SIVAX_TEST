"use client";

/**
 * Confidence Badge — displays a confidence level using Lucide icons
 * (not emojis). Used to annotate hypotheses, factors, and individual
 * data values with their verification status.
 *
 * Three levels:
 * - verified  (CheckCircle2, green)   — value checked against DHIS2 cell
 * - estimated (AlertTriangle, amber)  — derived calculation, no direct data
 * - unverified (XCircle, red)         — no DHIS2 data for this period/zone
 *
 * For diagnostic hypotheses, the confidence label maps as:
 * - élevée      → verified
 * - moyenne     → estimated
 * - faible      → unverified (amber variant)
 * - très faible → unverified
 *
 * Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §12.4.7
 */

import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type ConfidenceVariant = "verified" | "estimated" | "unverified";

interface ConfidenceBadgeProps {
  /** Variant determined by the caller based on the data context. */
  variant: ConfidenceVariant;
  /** Optional label override; defaults to the i18n label for the variant. */
  label?: string;
  /** Optional confidence score (0-1) to display alongside the icon. */
  score?: number;
  className?: string;
  size?: "sm" | "md";
}

const VARIANT_CONFIG: Record<
  ConfidenceVariant,
  { icon: typeof CheckCircle2; color: string; translationKey: string }
> = {
  verified: {
    icon: CheckCircle2,
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    translationKey: "verified",
  },
  estimated: {
    icon: AlertTriangle,
    color: "text-amber-600 bg-amber-50 border-amber-200",
    translationKey: "estimated",
  },
  unverified: {
    icon: XCircle,
    color: "text-red-600 bg-red-50 border-red-200",
    translationKey: "unverified",
  },
};

export function ConfidenceBadge({
  variant,
  label,
  score,
  className,
  size = "sm",
}: ConfidenceBadgeProps) {
  const t = useTranslations("analysis");
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;
  const displayLabel = label || t(config.translationKey);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        config.color,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
      title={displayLabel}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{displayLabel}</span>
      {score !== undefined && (
        <span className="opacity-70">({Math.round(score * 100)}%)</span>
      )}
    </span>
  );
}

/**
 * Map a diagnostic confidence label (from the backend) to a badge variant.
 *
 * - "élevée"      → verified
 * - "moyenne"     → estimated
 * - "faible"      → estimated (amber, but still shown)
 * - "très faible" → unverified
 */
export function confidenceLabelToVariant(label: string): ConfidenceVariant {
  const l = label.toLowerCase();
  if (l.includes("élev") || l.includes("elev")) return "verified";
  if (l.includes("très") || l.includes("tres") || l.includes("very")) return "unverified";
  if (l.includes("moy") || l.includes("medium") || l.includes("faible") || l.includes("low")) {
    return "estimated";
  }
  return "estimated";
}

/**
 * A compact confidence indicator for inline use next to a single value.
 * Shows just the icon without the label text.
 */
export function ConfidenceIcon({
  variant,
  className,
}: {
  variant: ConfidenceVariant;
  className?: string;
}) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;
  return <Icon className={cn("h-3.5 w-3.5", config.color.split(" ")[0], className)} />;
}

/** Fallback icon for unknown/unavailable confidence. */
export function UnknownConfidenceIcon({ className }: { className?: string }) {
  return <HelpCircle className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />;
}

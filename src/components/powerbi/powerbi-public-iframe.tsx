"use client";

/**
 * Power BI Public Iframe — affichage d'un rapport via un lien "Publier sur le web".
 *
 * Approche transitoire : le rapport est affiché dans un simple <iframe>
 * (pas de token d'embed, pas de SDK powerbi-client). Aucune commande de
 * l'agent IA ne peut piloter le rapport dans ce mode.
 *
 * L'approche Power BI Embedded (Azure AD + embed token) reste disponible
 * via `PowerBIEmbed` et est utilisée dès que `NEXT_PUBLIC_POWERBI_PUBLIC_URL`
 * est vide.
 */

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** URL publique par défaut du rapport (lien "Publier sur le web"). */
export const DEFAULT_POWERBI_PUBLIC_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiMzM1NDQ2ZDQtMWU5Ni00ZmE4LTg2ZTYtNWIwZjM2MDVjNTJmIiwidCI6ImEzNzk1YWM5LWI0ZTgtNDQ4OS1hZjcwLWZjNGVhNGE1MDYwYSJ9&pageName=161ec1979be2376c1139&disablecdnExpiration=1790450858";

/**
 * URL publique effective : variable d'environnement si définie, sinon la valeur
 * par défaut. Retourne `null` si explicitement désactivée via "off".
 */
export function getPowerBIPublicUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_POWERBI_PUBLIC_URL;
  if (raw === undefined || raw === "") return DEFAULT_POWERBI_PUBLIC_URL;
  if (raw.trim().toLowerCase() === "off") return null;
  return raw;
}

interface PowerBIPublicIframeProps {
  url?: string;
  title?: string;
  className?: string;
  onLoadingChange?: (loading: boolean) => void;
}

export function PowerBIPublicIframe({
  url = DEFAULT_POWERBI_PUBLIC_URL,
  title = "Power BI",
  className,
  onLoadingChange,
}: PowerBIPublicIframeProps) {
  const [loading, setLoading] = useState(true);

  return (
    <div className={cn("relative h-full w-full", className)}>
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-full max-w-4xl space-y-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
            <Skeleton className="h-[400px] w-full rounded-lg" />
          </div>
        </div>
      )}
      <iframe
        title={title}
        src={url}
        className={cn("h-full w-full border-0", loading && "invisible")}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => {
          setLoading(false);
          onLoadingChange?.(false);
        }}
      />
    </div>
  );
}

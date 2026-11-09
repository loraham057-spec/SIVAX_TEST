"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Reference sites of the immunization programme and its partners. */
const LINKS = [
  { key: "pev", name: "PEV RDC", url: "https://pevrdcongo.cd/", logo: "/logo_pev.jpg" },
  { key: "minsante", name: "Ministère de la Santé RDC", url: "https://sante.gouv.cd/", logo: "/logo_min_sante.png" },
  { key: "who", name: "OMS / WHO", url: "https://www.who.int/fr/health-topics/vaccines-and-immunization", logo: "/logos/partners/who.svg" },
  { key: "gavi", name: "Gavi", url: "https://www.gavi.org/", logo: "/logos/partners/gavi.png" },
  { key: "pfizer", name: "Pfizer", url: "https://www.pfizer.com/", logo: "/logos/partners/pfizer.svg" },
  { key: "villagereach", name: "VillageReach", url: "https://www.villagereach.org/", logo: "/logo_villagereach.png" },
] as const;

export default function UsefulLinksPage() {
  const t = useTranslations("help.links");

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/help">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {LINKS.map((l) => (
          <a
            key={l.key}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex h-20 items-center justify-center rounded-lg bg-white p-3 ring-1 ring-border/60">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static logos, sizes vary */}
                  <img src={l.logo} alt={l.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-muted-foreground">{t(`${l.key}Desc`)}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  {new URL(l.url).hostname.replace(/^www\./, "")}
                  <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}

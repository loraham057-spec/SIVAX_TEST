"use client";

import Link from "next/link";
import { HelpCircle, BookOpen, Link2, ArrowRight, Mail, ExternalLink, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

const FAQ_KEYS = ["faq1", "faq2", "faq3", "faq4", "faq5", "faq6", "faq7"] as const;

const SUPPORT_EMAIL = "contact@sivax.health";

export default function HelpPage() {
  const t = useTranslations("help");

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="mt-2 text-sm">{t("documentation")}</CardTitle>
            <CardDescription>{t("docsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/documentation">
              <Button variant="outline" size="sm" className="w-full">
                {t("viewDocs")}
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <Link2 className="h-5 w-5 text-accent" />
            </div>
            <CardTitle className="mt-2 text-sm">{t("usefulLinks")}</CardTitle>
            <CardDescription>{t("usefulLinksDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/help/links">
                {t("viewLinks")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="mt-2 text-sm">{t("contactSupport")}</CardTitle>
            <CardDescription>{t("supportDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="w-full">
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t("emailSubject"))}`}>
                {t("emailUs")}
                <Mail className="h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            <CardTitle>{t("faq")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="divide-y">
          {FAQ_KEYS.map((key) => (
            <details key={key} className="group py-1 first:pt-0 last:pb-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {t(`${key}q`)}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="pb-3 pr-8 text-sm text-muted-foreground">{t(`${key}a`)}</p>
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

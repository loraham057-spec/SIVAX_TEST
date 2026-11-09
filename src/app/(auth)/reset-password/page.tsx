"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/constants";
import { useTranslations } from "next-intl";

export default function ResetPasswordPage() {
  const t = useTranslations("resetPassword");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError(t("enterEmail"));
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("sendFailed"));
        setIsSubmitting(false);
        return;
      }

      setSent(true);
    } catch {
      setError(t("sendFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="rounded-2xl border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/logo_diav1.png"
              alt="SIVAX"
              width={64}
              height={64}
              className="rounded-xl"
            />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {sent ? (
            <div className="mt-8 space-y-4">
              <div className="flex flex-col items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-6 text-center">
                <MailCheck className="h-10 w-10 text-primary" />
                <p className="text-sm font-medium">{t("emailSent")}</p>
                <p className="text-xs text-muted-foreground">{t("emailSentDesc")}</p>
              </div>
              <div className="mt-6">
                <Link href="/login">
                  <Button variant="outline" className="w-full">
                    <ArrowLeft className="h-4 w-4" />
                    {t("backToLogin")}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("email")}</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@organization.gov"
                  className="h-12"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="h-12 w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("sending")}
                  </>
                ) : (
                  t("sendLink")
                )}
              </Button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("backToLogin")}
              </Link>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © 2026 {APP_NAME}. All rights reserved.
        </p>
      </motion.div>
    </div>
  );
}

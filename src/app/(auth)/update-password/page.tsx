"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/constants";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useTranslations } from "next-intl";

function UpdatePasswordForm() {
  const router = useRouter();
  const t = useTranslations("updatePassword");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isValidating, setIsValidating] = useState(true);

  // Validate that we have a valid session (established by /auth/callback)
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Valid session from the auth callback — user can update password
        setIsValidating(false);
      } else {
        // No valid session — the token was invalid or expired
        setError(t("invalidToken"));
        setIsValidating(false);
      }
    };

    void checkSession();
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("passwordsNoMatch"));
      return;
    }

    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(updateError.message || t("updateFailed"));
      setIsSubmitting(false);
      return;
    }

    setSuccess(true);
    setIsSubmitting(false);

    // Redirect to login after 3 seconds
    setTimeout(() => {
      router.push("/login");
    }, 3000);
  };

  if (isValidating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

          {success ? (
            <div className="mt-8 space-y-4">
              <div className="flex flex-col items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <p className="text-sm font-medium">{t("updateSuccess")}</p>
                <p className="text-xs text-muted-foreground">{t("redirecting")}</p>
              </div>
            </div>
          ) : error === t("invalidToken") ? (
            <div className="mt-8 space-y-4">
              <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="text-sm font-medium">{t("invalidToken")}</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/reset-password")}
              >
                {t("title")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("newPassword")}</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="h-12 pr-12"
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-0 top-0 flex h-full w-12 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("confirmPassword")}</label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="h-12 pr-12"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((prev) => !prev)}
                    className="absolute right-0 top-0 flex h-full w-12 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showConfirm ? t("hidePassword") : t("showPassword")}
                  >
                    {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
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
                    {t("updating")}
                  </>
                ) : (
                  t("update")
                )}
              </Button>
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

export default function UpdatePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <UpdatePasswordForm />
    </Suspense>
  );
}

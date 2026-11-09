"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/constants";
import { useAuth } from "@/lib/auth/auth-provider";
import { useTranslations } from "next-intl";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, user, isLoading } = useAuth();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const sessionExpired = searchParams.get("reason") === "session-timeout";

  useEffect(() => {
    setMounted(true);
    // Pre-fill email if "Remember me" was previously checked
    const savedEmail = localStorage.getItem("diav1_saved_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && user) {
      const redirect = searchParams.get("redirect") || "/dashboard";
      router.replace(redirect);
    }
  }, [user, isLoading, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError(t("enterCredentials"));
      return;
    }

    setIsSubmitting(true);

    const { error: signInError } = await signIn(email, password, rememberMe);

    if (signInError) {
      setError(signInError);
      setIsSubmitting(false);
      return;
    }

    // Save or clear email based on "Remember me"
    if (rememberMe) {
      localStorage.setItem("diav1_saved_email", email);
    } else {
      localStorage.removeItem("diav1_saved_email");
    }

    // Use full-page navigation instead of router.push to avoid double-loading
    // the AuthProvider (initAuth + onAuthStateChange). The middleware will
    // validate the session server-side and set the auth_verified cookie, so
    // subsequent navigations take the fast path.
    const redirect = searchParams.get("redirect") || "/dashboard";
    window.location.href = redirect;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      {!mounted ? (
        <div className="w-full max-w-md" />
      ) : (
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
              {t("welcome", { app: APP_NAME })}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {sessionExpired && (
            <div className="mt-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("sessionExpired")}</span>
            </div>
          )}

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

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("password")}</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="h-12 pr-12"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-0 top-0 flex h-full w-12 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                {t("rememberMe")}
              </label>
              <Link
                href="/reset-password"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("forgotPassword")}
              </Link>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              className="h-12 w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("signingIn")}
                </>
              ) : (
                t("signIn")
              )}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t("secureEncryption")}</span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("allRightsReserved", { app: APP_NAME })}
        </p>
        </motion.div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

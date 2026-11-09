"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createSupabaseBrowserClient();

      // Supabase redirects with hash fragment: #access_token=...&refresh_token=...&type=recovery
      // The @supabase/ssr browser client does NOT auto-detect the hash,
      // so we need to manually extract and set the session.
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const type = hashParams.get("type");

      if (accessToken && refreshToken) {
        // Set the session from the hash tokens
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) {
          console.error("[auth/callback] setSession error:", sessionError.message);
          setError(true);
          setTimeout(() => router.push("/login?reason=session-timeout"), 2000);
          return;
        }

        // Clear the hash from the URL
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, "", window.location.pathname);
        }

        // Redirect to update-password page
        router.push("/update-password");
        return;
      }

      // No hash tokens — check if we already have a valid session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/update-password");
      } else {
        setError(true);
        setTimeout(() => router.push("/login?reason=session-timeout"), 2000);
      }
    };

    void handleCallback();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {error ? (
        <p className="text-sm text-destructive">Invalid or expired reset link. Redirecting...</p>
      ) : (
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      )}
    </div>
  );
}

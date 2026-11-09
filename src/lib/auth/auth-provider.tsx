"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { UserProfile, UserRole } from "@/lib/auth/types";
import { usePushSubscription } from "@/lib/hooks/use-push-subscription";
import { useAppBadge } from "@/lib/hooks/use-app-badge";

interface AuthContextValue {
  user: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = createSupabaseBrowserClient();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to push notifications and track app badge
  usePushSubscription(user?.id);
  useAppBadge(user?.id);

  const fetchUserProfile = async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
    return data as UserProfile;
  };

  const refreshUser = async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      const profile = await fetchUserProfile(currentUser.id);
      setUser(profile);
    } else {
      setUser(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      // Parallelize getUser + getSession to avoid sequential round-trips
      const [userResult, sessionResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      if (!mounted) return;

      const initialUser = userResult.data.user;
      const initialSession = sessionResult.data.session;

      if (initialUser) {
        // Check ephemeral session: if the user chose "don't remember me",
        // the session should only persist within the current browser tab.
        // localStorage flag survives browser restart; sessionStorage does not.
        const isEphemeral = localStorage.getItem("diav1_ephemeral") === "1";
        const tabActive = sessionStorage.getItem("diav1_tab") === "1";

        if (isEphemeral && !tabActive) {
          // Browser was closed and reopened (or new tab) — sign out ephemeral session
          localStorage.removeItem("diav1_ephemeral");
          await supabase.auth.signOut();
          if (mounted) {
            setUser(null);
            setSession(null);
            setIsLoading(false);
          }
          return;
        }

        // Mark this tab as active so refreshes within the same tab keep the session
        sessionStorage.setItem("diav1_tab", "1");

        setSession(initialSession);
        const profile = await fetchUserProfile(initialUser.id);
        if (mounted) setUser(profile);
      }
      if (mounted) setIsLoading(false);
    };

    initAuth();

    // Track whether initAuth has already loaded the profile, so
    // onAuthStateChange doesn't do a redundant fetchUserProfile.
    let profileLoaded = false;

    // Kick off initAuth and mark profileLoaded when it finishes
    const initPromise = initAuth().then(() => { profileLoaded = true; });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, newSession: Session | null) => {
        if (!mounted) return;
        setSession(newSession);
        if (newSession?.user) {
          // Skip profile fetch if initAuth already loaded it (avoids double DB call)
          if (profileLoaded) {
            setIsLoading(false);
            return;
          }
          profileLoaded = true;
          const profile = await fetchUserProfile(newSession.user.id);
          if (mounted) setUser(profile);
        } else {
          setUser(null);
          profileLoaded = false;
          // Redirect to login when session is lost (expired, revoked, signed out)
          if (event === "SIGNED_OUT" || event === "TOKEN_REFRESH_FAILED") {
            if (typeof window !== "undefined") {
              window.location.href = "/login?reason=session-timeout";
            }
          }
        }
        setIsLoading(false);
      }
    );

    // Ensure initPromise doesn't float (unhandled rejection in edge cases)
    void initPromise;

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;

    // ─── Client-side cache for security policy ───────────────
    // The security policy rarely changes. Caching it avoids a network
    // round-trip (which took 5-18s in some cases) on every session change.
    const POLICY_CACHE_KEY = "diav1_security_policy";
    const POLICY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

    const configure = async () => {
      try {
        // Try cache first
        let policy: Record<string, unknown> | null = null;
        try {
          const cached = localStorage.getItem(POLICY_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.timestamp && Date.now() - parsed.timestamp < POLICY_CACHE_TTL) {
              policy = parsed.policy;
            }
          }
        } catch {
          // ignore parse errors
        }

        // Fetch from server if no valid cache
        if (!policy) {
          const response = await fetch("/api/settings/security-policy", { cache: "no-store" });
          if (!response.ok || !active) return;
          policy = await response.json();
          // Cache the result
          try {
            localStorage.setItem(
              POLICY_CACHE_KEY,
              JSON.stringify({ policy, timestamp: Date.now() })
            );
          } catch {
            // localStorage might be full or unavailable
          }
        }

        if (!active || !policy) return;
        if (!policy.sessionTimeout) return;

        const duration = Math.max(5, Number(policy.sessionTimeoutMinutes) || 30) * 60_000;
        const reset = () => {
          if (timeoutId) clearTimeout(timeoutId);
          timeoutId = setTimeout(async () => {
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session-timeout";
          }, duration);
        };

        events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
        reset();
        return () => events.forEach((event) => window.removeEventListener(event, reset));
      } catch {
        return;
      }
    };

    let removeListeners: (() => void) | undefined;
    void configure().then((cleanup) => {
      removeListeners = cleanup;
    });

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      removeListeners?.();
    };
  }, [session, supabase]);

  const signIn = async (email: string, password: string, rememberMe: boolean = true) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }

    if (rememberMe) {
      // Persistent session: clear any ephemeral flags
      localStorage.removeItem("diav1_ephemeral");
    } else {
      // Ephemeral session: mark so we can sign out on browser restart
      localStorage.setItem("diav1_ephemeral", "1");
    }
    // Always mark the current tab as active
    sessionStorage.setItem("diav1_tab", "1");

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("diav1_ephemeral");
    sessionStorage.removeItem("diav1_tab");
    setUser(null);
    setSession(null);
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, session, isLoading, signIn, signOut, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

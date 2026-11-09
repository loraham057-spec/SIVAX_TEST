"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/layout/top-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { AssistantDrawer } from "@/components/assistant/assistant-drawer";
import { useAssistant } from "@/store/assistant-store";
import { useAgent } from "@/lib/agent/agent-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Routes to prefetch after the shell mounts. In production, Next.js prefetches
// <Link> targets on hover/viewport, but explicitly prefetching on mount
// ensures the chunks are warm before the user clicks.
const PREFETCH_ROUTES = [
  "/dashboard",
  "/assistant",
  "/reports",
  "/notifications",
  "/settings",
  "/help",
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true);
  const { isOpen: assistantOpen } = useAssistant();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prefetch all navigable routes once the shell is mounted and the user is
  // authenticated. This warms the route cache so subsequent navigations are
  // near-instant. We skip the current route to avoid redundant work.
  useEffect(() => {
    if (!user) return;
    for (const route of PREFETCH_ROUTES) {
      if (route !== pathname) {
        void router.prefetch(route);
      }
    }
  }, [user, router, pathname]);

  const handleMenuClick = useCallback(() => {
    if (window.innerWidth >= 1024) {
      setDesktopSidebarVisible((prev) => !prev);
    } else {
      setMobileSidebarOpen((prev) => !prev);
    }
  }, []);

  // Register toggle_sidebar handler with the agent.
  const { register } = useAgent();
  useEffect(() => {
    return register("toggle_sidebar", () => {
      handleMenuClick();
    });
  }, [register, handleMenuClick]);

  // Block rendering until we confirm the user is authenticated
  // Render null on server to avoid hydration mismatch with browser extensions
  if (!mounted) {
    return null;
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Middleware should redirect, but as a client-side safety net
    // we render nothing to avoid showing dashboard data to
    // unauthenticated users.
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav onMenuClick={handleMenuClick} desktopSidebarVisible={desktopSidebarVisible} />
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        desktopVisible={desktopSidebarVisible}
      />

      <div
        className={cn(
          "transition-all duration-300 lg:pl-16",
          desktopSidebarVisible && "lg:pl-64",
          assistantOpen && "lg:pr-[420px]"
        )}
      >
        <main className="pt-[72px]">
          {/* Lightweight CSS-only fade-in on route change.
              Replaced AnimatePresence mode="wait" which added ~400ms of
              blocking latency (exit animation had to complete before the
              new page could mount). This approach mounts immediately and
              animates opacity without blocking. */}
          <div
            key={pathname}
            className="animate-in fade-in duration-200"
          >
            {children}
          </div>
        </main>
      </div>

      <AssistantDrawer />
    </div>
  );
}

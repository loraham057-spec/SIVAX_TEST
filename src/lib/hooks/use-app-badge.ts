"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type NavigatorWithBadge = Navigator & {
  setAppBadge?: (n: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useAppBadge(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    const nav = navigator as NavigatorWithBadge;
    if (!nav.setAppBadge && !nav.clearAppBadge) return;

    const supabase = createSupabaseBrowserClient();

    const updateBadge = async () => {
      try {
        const { count, error } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .or(`user_id.eq.${userId},user_id.is.null`)
          .is("read_at", null);

        if (error) return;

        if (count && count > 0) {
          nav.setAppBadge?.(count).catch(() => {});
        } else {
          nav.clearAppBadge?.().catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    updateBadge();

    // Realtime: listen to all notification changes (including broadcast null user_id)
    const channel = supabase
      .channel("notifications-badge")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
        },
        () => updateBadge()
      )
      .subscribe();

    const onFocus = () => updateBadge();
    window.addEventListener("focus", onFocus);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);
}

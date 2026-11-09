"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let currentBuildId: string | null = null;

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch {
        // SW registration failed
      }
    };

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      toast.success("App updated to the latest version", {
        description: "Reloading...",
        duration: 1500,
      });
      setTimeout(() => window.location.reload(), 800);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // When user taps a push notification, navigate or reload
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "NOTIFICATION_CLICKED") {
        const url = event.data.url;
        if (url && url !== window.location.pathname) {
          window.location.href = url;
        } else {
          window.location.reload();
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    const checkVersion = async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();

        if (currentBuildId === null) {
          currentBuildId = data.buildId;
          return;
        }

        if (data.buildId !== currentBuildId) {
          currentBuildId = data.buildId;

          // Show in-app toast (push notification is sent server-side at build time via Supabase trigger)
          toast.info("New version available", {
            description: "Updating the app...",
            duration: 2000,
          });

          // Trigger SW update
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
          } else {
            window.location.reload();
          }
        }
      } catch {
        // Network error
      }
    };

    registerSW();
    checkVersion();
    const interval = setInterval(checkVersion, 60_000);

    const onFocus = () => checkVersion();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}

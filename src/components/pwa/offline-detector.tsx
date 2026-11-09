"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function OfflineDetector() {
  const router = useRouter();

  useEffect(() => {
    const isOnOfflinePage = () => window.location.pathname === "/offline";

    const goOffline = () => {
      if (isOnOfflinePage()) return;
      const from = window.location.pathname + window.location.search;
      router.push(`/offline?redirect=${encodeURIComponent(from)}`);
    };

    const handleOnline = () => {
      if (!isOnOfflinePage()) return;
      const redirect = new URLSearchParams(window.location.search).get("redirect");
      router.push(redirect?.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard");
    };

    if (!navigator.onLine) goOffline();

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [router]);

  return null;
}

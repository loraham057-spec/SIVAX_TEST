"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { WifiOff, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";

const DEFAULT_TARGET = "/dashboard";

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/offline")) {
    return DEFAULT_TARGET;
  }
  return value;
}

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(true);
  const [target, setTarget] = useState(DEFAULT_TARGET);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    setTarget(safeRedirect(new URLSearchParams(window.location.search).get("redirect")));

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex max-w-md flex-col items-center"
      >
        <Image
          src="/logo_diav1.png"
          alt="SIVAX"
          width={64}
          height={64}
          className="rounded-xl opacity-40 grayscale"
        />

        <div className="mt-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          <WifiOff className="h-10 w-10 text-muted-foreground" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">
          Vous êtes hors ligne
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {APP_NAME} ne peut pas se connecter à internet pour le moment.
          Certaines fonctionnalités peuvent être indisponibles.
          Vos données en cache restent accessibles.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${
              isOnline ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span>
            {isOnline
              ? "Connexion rétablie — vous pouvez réessayer"
              : "Toujours hors ligne — vérifiez votre connexion"}
          </span>
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            variant="outline"
            onClick={() => window.location.assign(target)}
          >
            <RotateCcw className="h-4 w-4" />
            Réessayer
          </Button>
          <Button onClick={() => window.location.assign(DEFAULT_TARGET)}>
            Retour à l'application
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

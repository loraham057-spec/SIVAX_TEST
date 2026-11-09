"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIProcessingStatus } from "@/lib/ai-processing";

interface Step {
  id: number;
  status: AIProcessingStatus;
  message: string;
  completed: boolean;
  error?: boolean;
}

interface HealthLoadingAnimationProps {
  /** Message affiché sous l'animation (quand aucun statut n'est actif). */
  label?: string;
  /** Sous-message secondaire (ex: étape courante). */
  sublabel?: string;
  /** Statut fonctionnel du pipeline IA — déclenche l'affichage de la liste d'étapes. */
  status?: AIProcessingStatus | null;
  /** Message traduit correspondant au statut courant. */
  statusMessage?: string;
  className?: string;
}

/** Durée totale d'un cycle en secondes. */
const CYCLE = 5;

/**
 * Animation de chargement thème vaccination & logistique.
 *
 * Séquence en boucle (5 s) :
 *   1. Une main gantée dépose une seringue dans un carton ouvert.
 *   2. Les rabats du carton se ferment (scellé avec badge de validation).
 *   3. Le carton fermé se déplace vers la droite (transport/distribution).
 *
 * Construite en SVG animé via framer-motion — aucun asset externe.
 */
export function HealthLoadingAnimation({
  label = "Analyse des données vaccinales en cours…",
  sublabel,
  status,
  statusMessage,
  className,
}: HealthLoadingAnimationProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const stepIdRef = useRef(0);

  // ─── Track status changes into a step list ──────────────
  // Each new status marks the previous step as completed and
  // adds a new active step. "completed" marks all as done.
  // "error" marks the last step as errored.
  useEffect(() => {
    if (status === "completed") {
      setSteps((prev) => prev.map((s) => ({ ...s, completed: true })));
      return;
    }

    if (status === "error") {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === prev.length - 1 ? { ...s, completed: true, error: true } : s
        )
      );
      return;
    }

    if (!status || !statusMessage) return;

    setSteps((prev) => {
      // Same status still active — update message only
      const last = prev[prev.length - 1];
      if (last && last.status === status && !last.completed) {
        return prev;
      }
      // Mark all previous as completed, add new active step
      const completed = prev.map((s) => ({ ...s, completed: true }));
      return [...completed, {
        id: ++stepIdRef.current,
        status,
        message: statusMessage,
        completed: false,
      }];
    });
  }, [status, statusMessage]);

  const hasSteps = steps.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-6 py-10",
        className
      )}
    >
      <div className="relative flex h-48 w-48 items-center justify-center">
        {/* Anneaux pulsants en arrière-plan */}
        {[0, 1].map((i) => (
          <motion.div
            key={`ring-${i}`}
            className="absolute rounded-full border-2 border-primary/20"
            style={{ inset: 0 }}
            initial={{ scale: 0.5, opacity: 0.5 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeOut",
              delay: i * 1.5,
            }}
          />
        ))}

        {/* Halo lumineux */}
        <motion.div
          className="absolute h-28 w-28 rounded-full bg-primary/10 blur-2xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />

        <svg viewBox="0 0 240 200" className="relative h-44 w-44" fill="none">
          <defs>
            <linearGradient id="boxGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="flapGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.12" />
            </linearGradient>
            <linearGradient id="syringeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--accent))" />
            </linearGradient>
          </defs>

          {/* Ligne de sol */}
          <line
            x1="40"
            y1="162"
            x2="200"
            y2="162"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.25"
          />

          {/* Ombre sous le carton (se déplace avec lui) */}
          <motion.ellipse
            cx={120}
            cy={163}
            rx={42}
            ry={5}
            fill="hsl(var(--primary))"
            animate={{
              cx: [120, 120, 180, 120],
              opacity: [0.12, 0.12, 0, 0.12],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              ease: "easeInOut",
              cx: { times: [0, 0.6, 0.9, 1] },
              opacity: { times: [0, 0.6, 0.85, 1] },
            }}
          />

          {/* Lignes de vitesse pendant le transport */}
          <motion.g
            animate={{
              opacity: [0, 0, 1, 0, 0],
              x: [0, 0, 0, -20, 0],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              ease: "easeOut",
              opacity: { times: [0, 0.6, 0.72, 0.88, 1] },
              x: { times: [0, 0.6, 0.72, 0.88, 1] },
            }}
          >
            <line x1="72" y1="118" x2="55" y2="118" stroke="hsl(var(--accent))" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="78" y1="132" x2="48" y2="132" stroke="hsl(var(--accent))" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
            <line x1="70" y1="146" x2="58" y2="146" stroke="hsl(var(--accent))" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
          </motion.g>

          {/* ═════════ Groupe carton (se déplace pendant le transport) ═════════ */}
          <motion.g
            animate={{
              x: [0, 0, 60, 0],
              y: [0, 0, -3, 0, -3, 0, 0],
              opacity: [1, 1, 0, 0, 1],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              ease: "easeInOut",
              x: { times: [0, 0.6, 0.9, 1] },
              y: { times: [0, 0.6, 0.66, 0.74, 0.82, 0.88, 1] },
              opacity: { times: [0, 0.6, 0.85, 0.95, 1] },
            }}
          >
            {/* Corps du carton (forme en U, ouvert en haut) */}
            <path
              d="M85 105 V155 H155 V105"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeLinejoin="round"
              fill="url(#boxGrad)"
            />

            {/* Profondeur 3D — fond du carton */}
            <path
              d="M85 155 L92 162 L162 162 L155 155"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              fill="hsl(var(--primary))"
              fillOpacity="0.08"
              strokeLinejoin="round"
            />

            {/* Profondeur 3D — côté droit du carton */}
            <path
              d="M155 105 L162 98 L162 148 L155 155"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              fill="hsl(var(--primary))"
              fillOpacity="0.06"
              strokeLinejoin="round"
            />

            {/* Profondeur 3D — arête arrière */}
            <line x1="85" y1="105" x2="92" y2="98" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.5" />
            <line x1="92" y1="98" x2="162" y2="98" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.5" />

            {/* Croix médicale sur la face avant du carton */}
            <rect x="117" y="122" width="6" height="18" rx="1" fill="hsl(var(--primary))" opacity="0.5" />
            <rect x="111" y="128" width="18" height="6" rx="1" fill="hsl(var(--primary))" opacity="0.5" />

            {/* Rabat gauche (charnière à 85,105) */}
            <motion.g
              animate={{ rotate: [-50, -50, 0, 0, -50] }}
              transition={{
                duration: CYCLE,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.30, 0.50, 0.90, 1],
              }}
              style={{ transformOrigin: "85px 105px" }}
            >
              <rect
                x="85"
                y="97"
                width="35"
                height="9"
                rx="1.5"
                fill="url(#flapGrad)"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
              />
            </motion.g>

            {/* Rabat droit (charnière à 155,105) */}
            <motion.g
              animate={{ rotate: [50, 50, 0, 0, 50] }}
              transition={{
                duration: CYCLE,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.30, 0.50, 0.90, 1],
              }}
              style={{ transformOrigin: "155px 105px" }}
            >
              <rect
                x="120"
                y="97"
                width="35"
                height="9"
                rx="1.5"
                fill="url(#flapGrad)"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
              />
            </motion.g>

            {/* Ruban de scellage sur les rabats fermés */}
            <motion.rect
              x="118"
              y="96"
              width="4"
              height="11"
              rx="1"
              fill="hsl(var(--accent))"
              animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
              transition={{
                duration: CYCLE,
                repeat: Infinity,
                ease: "easeInOut",
                times: [0, 0.48, 0.52, 0.85, 0.90, 1],
              }}
            />

            {/* Badge de validation "scellé" */}
            <motion.g
              animate={{
                opacity: [0, 0, 1, 1, 0, 0],
                scale: [0, 0, 1, 1, 0, 0],
              }}
              transition={{
                duration: CYCLE,
                repeat: Infinity,
                ease: "easeOut",
                opacity: { times: [0, 0.50, 0.56, 0.82, 0.88, 1] },
                scale: { times: [0, 0.50, 0.56, 0.82, 0.88, 1] },
              }}
              style={{ transformOrigin: "155px 100px" }}
            >
              <circle cx="155" cy="100" r="8" fill="hsl(var(--accent))" />
              <path
                d="M151 100 L154 103 L160 97"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.g>
          </motion.g>

          {/* ═════════ Seringue + main gantée (descend, séparée du carton) ═════════ */}
          <motion.g
            animate={{
              y: [-60, 55, 55, 55, -60],
              opacity: [0, 1, 1, 0, 0, 0],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              ease: "easeInOut",
              y: { times: [0, 0.30, 0.45, 0.60, 1] },
              opacity: { times: [0, 0.05, 0.28, 0.38, 0.60, 1] },
            }}
          >
            {/* Main gantée tenant la seringue */}
            <ellipse
              cx="120"
              cy="16"
              rx="11"
              ry="9"
              fill="hsl(var(--primary))"
              fillOpacity="0.15"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
            />
            {/* Doigts */}
            <line x1="114" y1="11" x2="114" y2="22" stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <line x1="120" y1="9" x2="120" y2="24" stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <line x1="126" y1="11" x2="126" y2="22" stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.4" strokeLinecap="round" />

            {/* Bouton du piston */}
            <rect x="116" y="22" width="8" height="4" rx="1.5" fill="hsl(var(--primary))" />
            {/* Tige du piston */}
            <line x1="120" y1="26" x2="120" y2="36" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" />
            {/* Baril */}
            <rect x="113" y="36" width="14" height="18" rx="2" fill="hsl(var(--primary))" fillOpacity="0.12" stroke="hsl(var(--primary))" strokeWidth="2" />
            {/* Liquide vaccinal dans le baril */}
            <rect x="114" y="44" width="12" height="9" rx="1" fill="url(#syringeGrad)" opacity="0.6" />
            {/* Embase */}
            <rect x="108" y="52" width="24" height="3.5" rx="1.5" fill="hsl(var(--primary))" />
            {/* Aiguille */}
            <line x1="120" y1="55.5" x2="120" y2="70" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" />
            {/* Pointe de l'aiguille */}
            <circle cx="120" cy="70" r="1.5" fill="hsl(var(--accent))" />
          </motion.g>
        </svg>
      </div>

      {/* Liste d'étapes ou label statique */}
      {hasSteps ? (
        <div className="flex w-full max-w-sm flex-col items-start gap-2.5 text-left">
          <AnimatePresence mode="popLayout">
            {steps.map((step) => (
              <motion.div
                key={step.id}
                className="flex items-center gap-2.5"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {/* Icône : check coché / spinner / erreur */}
                {step.error ? (
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                ) : step.completed ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 350, damping: 20 }}
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  </motion.div>
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "text-sm transition-colors duration-300",
                    step.error
                      ? "text-destructive"
                      : step.completed
                        ? "text-muted-foreground"
                        : "font-medium text-foreground"
                  )}
                >
                  {step.message}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {sublabel && (
            <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <motion.p
            className="text-sm font-medium text-foreground"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            {label}
          </motion.p>
          {sublabel && (
            <p className="text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
      )}
    </div>
  );
}

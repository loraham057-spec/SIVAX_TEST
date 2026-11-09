"use client";

import { motion } from "framer-motion";
import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecordingFieldProps {
  isRecording: boolean;
  isTranscribing: boolean;
  recordingSeconds: number;
  audioLevel: number;
  onStopRecording: () => void;
  onCancel: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingField({
  isRecording,
  isTranscribing,
  recordingSeconds,
  audioLevel,
  onStopRecording,
  onCancel,
}: RecordingFieldProps) {
  if (!isRecording && !isTranscribing) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5",
        "min-h-[40px] flex-1"
      )}
    >
      {isTranscribing ? (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Transcribing…</span>
        </>
      ) : (
        <>
          {/* Pulsing red dot */}
          <motion.div
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Waveform animation — bars react to audio level */}
          <div className="flex h-6 items-center gap-[2px]">
            {Array.from({ length: 24 }).map((_, i) => {
              const distance = Math.abs(i - 12);
              const baseHeight = 3;
              const levelBoost = Math.max(0, audioLevel - distance * 4);
              const height = baseHeight + levelBoost * 0.8;
              return (
                <motion.div
                  key={i}
                  className="w-[2px] rounded-full bg-primary/60"
                  animate={{ height: [height, height * 1.5, height] }}
                  transition={{
                    duration: 0.4,
                    repeat: Infinity,
                    delay: i * 0.03,
                    ease: "easeInOut",
                  }}
                />
              );
            })}
          </div>

          {/* Timer */}
          <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(recordingSeconds)}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Check — stop recording and finalize transcript */}
            <button
              onClick={onStopRecording}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
              aria-label="Finalize recording"
            >
              <Check className="h-4 w-4" />
            </button>

            {/* Cancel — discard recording */}
            <button
              onClick={onCancel}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
              aria-label="Cancel recording"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceInputProps {
  onTranscript?: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  onTranscribingStateChange?: (isTranscribing: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onRecordingTime?: (seconds: number) => void;
}

// Web Speech API type declarations (minimal)
interface SpeechRecognitionEvent extends Event {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInput({
  onTranscript,
  onRecordingStateChange,
  onTranscribingStateChange,
  onAudioLevel,
  onRecordingTime,
}: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const shouldRestartRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);

  const stopRecognition = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRecognition();
    stopAudioAnalysis();
    stopTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    finalTranscriptRef.current = "";
  }, [stopRecognition, stopAudioAnalysis, stopTimer]);

  const handleStartRecording = useCallback(async () => {
    try {
      // Start MediaRecorder for high-quality ElevenLabs transcription
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

      // Start audio level analysis for waveform
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          onAudioLevel?.(Math.min(100, Math.round((avg / 128) * 100)));
          animationFrameRef.current = requestAnimationFrame(tick);
        };
        animationFrameRef.current = requestAnimationFrame(tick);
      } catch {}

      // Start recording timer
      recordingStartRef.current = Date.now();
      onRecordingTime?.(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
        onRecordingTime?.(elapsed);
      }, 1000);

      // Start Web Speech API for transcript (final results only)
      const SpeechRecognition = getSpeechRecognition();
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        const navLang = typeof navigator !== "undefined" ? navigator.language : "fr";
        recognition.lang = navLang?.startsWith("en") && !navLang?.includes("fr")
          ? "en-US"
          : "fr-FR";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let final = "";
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript + " ";
            }
          }
          if (final) {
            finalTranscriptRef.current += final;
          }
        };

        recognition.onerror = (e: Event) => {
          const err = e as unknown as { error?: string };
          if (err.error === "not-allowed" || err.error === "service-not-allowed") {
            shouldRestartRef.current = false;
          }
        };

        recognition.onend = () => {
          if (shouldRestartRef.current) {
            try { recognition.start(); } catch {}
          }
        };

        shouldRestartRef.current = true;
        recognition.start();
        recognitionRef.current = recognition;
      }

      setIsRecording(true);
      onRecordingStateChange?.(true);
    } catch {
      setIsRecording(false);
      onRecordingStateChange?.(false);
    }
  }, [onRecordingStateChange, onAudioLevel, onRecordingTime, stopRecognition]);

  const handleStopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setIsRecording(false);
    onRecordingStateChange?.(false);

    stopRecognition();
    stopAudioAnalysis();
    stopTimer();
    onAudioLevel?.(0);

    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        resolve(blob);
      };
      recorder.stop();
    });

    cleanup();

    if (audioBlob.size === 0) {
      if (finalTranscriptRef.current && onTranscript) {
        onTranscript(finalTranscriptRef.current);
      }
      return;
    }

    // If Web Speech already gave us text, use it immediately
    if (finalTranscriptRef.current && onTranscript) {
      onTranscript(finalTranscriptRef.current);
    }

    // Also send to ElevenLabs for higher accuracy (replaces if better)
    setIsTranscribing(true);
    onTranscribingStateChange?.(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const res = await fetch("/api/assistant/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Transcription failed");
      }

      const data = await res.json();
      if (data.text && onTranscript) {
        onTranscript(data.text);
      }
    } catch {
      // If ElevenLabs fails but we have Web Speech text, keep it
    } finally {
      setIsTranscribing(false);
      onTranscribingStateChange?.(false);
      finalTranscriptRef.current = "";
    }
  }, [onTranscript, onRecordingStateChange, onTranscribingStateChange, onAudioLevel, cleanup, stopRecognition, stopAudioAnalysis, stopTimer]);

  const handleCancel = useCallback(() => {
    setIsRecording(false);
    onRecordingStateChange?.(false);
    stopRecognition();
    stopAudioAnalysis();
    stopTimer();
    onAudioLevel?.(0);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    cleanup();
    finalTranscriptRef.current = "";
  }, [onRecordingStateChange, onAudioLevel, cleanup, stopRecognition, stopAudioAnalysis, stopTimer]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Allow external cancel via custom event
  useEffect(() => {
    const handler = () => handleCancel();
    window.addEventListener("voice-input-cancel", handler);
    return () => window.removeEventListener("voice-input-cancel", handler);
  }, [handleCancel]);

  // Allow external stop via custom event
  useEffect(() => {
    const handler = () => { void handleStopRecording(); };
    window.addEventListener("voice-input-stop", handler);
    return () => window.removeEventListener("voice-input-stop", handler);
  }, [handleStopRecording]);

  return (
    <Button
      variant={isRecording ? "destructive" : "outline"}
      size="icon"
      onClick={isRecording ? handleStopRecording : handleStartRecording}
      disabled={isTranscribing}
      className={cn("rounded-full shrink-0", isRecording && "animate-pulse")}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
    >
      {isTranscribing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}

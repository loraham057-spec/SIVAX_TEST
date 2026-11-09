"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Sparkles, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssistant } from "@/store/assistant-store";
import { VoiceInput } from "@/components/assistant/voice-input";
import { RecordingField } from "@/components/assistant/recording-field";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export default function AssistantPage() {
  const { messages, isTyping, sendMessage, clearMessages } = useAssistant();
  const t = useTranslations("assistant");
  const tPrompts = useTranslations("prompts");

  const suggestedPrompts = [tPrompts("suggestion1"), tPrompts("suggestion2"), tPrompts("suggestion3")];
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancelRecording = () => {
    window.dispatchEvent(new Event("voice-input-cancel"));
    setAudioLevel(0);
    setRecordingSeconds(0);
  };

  const handleStopRecording = () => {
    window.dispatchEvent(new Event("voice-input-stop"));
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-4 lg:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("title")}</h1>
            <p className="text-xs text-muted-foreground">{t("placeholder")}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={clearMessages}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback
                    className={cn(
                      "text-xs",
                      msg.role === "assistant"
                        ? "bg-primary/10 text-primary"
                        : "bg-accent/10 text-accent-foreground"
                    )}
                  >
                    {msg.role === "assistant" ? <Sparkles className="h-3.5 w-3.5" /> : "NM"}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm",
                    msg.role === "assistant" ? "bg-muted/50" : "bg-primary text-primary-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {msg.suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => sendMessage(s)}
                          className="rounded-md border bg-background px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/10"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-1 rounded-lg bg-muted/50 px-3 py-3">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {messages.length <= 1 && !isTyping && (
              <div className="space-y-2 pt-4">
                <Separator />
                <p className="text-xs font-medium text-muted-foreground">{t("suggestedPrompts")}</p>
                <div className="flex flex-col gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/10"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            {isRecording || isTranscribing ? (
              <RecordingField
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                recordingSeconds={recordingSeconds}
                audioLevel={audioLevel}
                onStopRecording={handleStopRecording}
                onCancel={handleCancelRecording}
              />
            ) : (
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("placeholder")}
                className="min-h-[40px] max-h-[160px] resize-none flex-1 overflow-y-auto"
                rows={1}
              />
            )}
            {!(isRecording || isTranscribing) && (
              <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
            <div className={cn(isRecording || isTranscribing ? "hidden" : "")}>
              <VoiceInput
                onTranscript={(text) => text && setInput(text)}
                onRecordingStateChange={setIsRecording}
                onTranscribingStateChange={setIsTranscribing}
                onAudioLevel={setAudioLevel}
                onRecordingTime={setRecordingSeconds}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

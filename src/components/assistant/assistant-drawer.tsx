"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Trash2, Plus, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssistant } from "@/store/assistant-store";
import { SUGGESTED_PROMPT_KEYS } from "@/lib/constants";
import { VoiceInput } from "@/components/assistant/voice-input";
import { RecordingField } from "@/components/assistant/recording-field";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/assistant/markdown-message";
import { useTranslations, useLocale } from "next-intl";

/**
 * Formate un temps écoulé relatif : "il y a 4 min", "il y a 5 jours", "last month"…
 */
function timeAgo(date: Date, locale: string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (seconds < 60) return rtf.format(-Math.max(seconds, 1), "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return rtf.format(-weeks, "week");
  const months = Math.floor(days / 30);
  if (months < 12) return rtf.format(-months, "month");
  const years = Math.floor(days / 365);
  return rtf.format(-years, "year");
}

export function AssistantDrawer() {
  const {
    isOpen,
    close,
    messages,
    isTyping,
    sendMessage,
    newConversation,
    loadConversation,
    deleteConversation,
    conversations,
    activeConversationId,
    activeConversationTitle,
    isLoadingHistory,
  } = useAssistant();
  const t = useTranslations("assistant");
  const tPrompts = useTranslations("prompts");
  const locale = useLocale();

  const suggestedPrompts = SUGGESTED_PROMPT_KEYS.map((key) => tPrompts(key));
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea: grows up to 160px, then scrolls
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Close history dropdown when clicking outside
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHistory]);

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

  const handlePromptClick = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleVoiceTranscript = (text: string) => {
    if (text) setInput(text);
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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="assistant-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={close}
        />
      )}
      {isOpen && (
        <motion.div
          key="assistant-drawer"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full flex-col border-l bg-card shadow-2xl lg:top-16 lg:h-[calc(100vh-4rem)] lg:shadow-none",
            "w-full lg:w-[420px]"
          )}
        >
            <div className="flex h-16 items-center justify-between border-b px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <Sparkles className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold">{t("title")}</p>
                  {activeConversationTitle && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Nouvelle conversation */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={newConversation}
                  aria-label={t("newChat")}
                  title={t("newChat")}
                >
                  <Plus className="h-4 w-4" />
                </Button>

                {/* Historique des conversations */}
                <div className="relative" ref={historyRef}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowHistory((prev) => !prev)}
                    aria-label={t("history")}
                    title={t("history")}
                  >
                    <Clock className="h-4 w-4" />
                  </Button>
                  <AnimatePresence>
                    {showHistory && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        style={{ width: 360 }}
                        className="absolute right-0 top-full z-50 mt-1 rounded-lg border bg-popover p-1 shadow-lg"
                      >
                        <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
                          {t("historyTitle")}
                        </p>
                        <div className="max-h-64 overflow-y-auto">
                          {conversations.length === 0 ? (
                            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                              {t("noHistory")}
                            </p>
                          ) : (
                            conversations.map((conv) => (
                              <div
                                key={conv.id}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/10",
                                  conv.id === activeConversationId && "bg-accent/10"
                                )}
                              >
                                {conv.id === activeConversationId ? (
                                  <Check className="h-4 w-4 shrink-0 text-primary" />
                                ) : (
                                  <span className="h-4 w-4 shrink-0" />
                                )}
                                <button
                                  onClick={() => {
                                    void loadConversation(conv.id);
                                    setShowHistory(false);
                                  }}
                                  title={conv.title}
                                  className="min-w-0 flex-1 overflow-hidden text-left"
                                >
                                  <span className={cn(
                                    "block truncate",
                                    conv.id === activeConversationId && "font-medium"
                                  )}>
                                    {conv.title}
                                  </span>
                                </button>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {timeAgo(new Date(conv.updated_at), locale)}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteConversation(conv.id);
                                  }}
                                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={t("clear")}
                                  title={t("clear")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Fermer */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={close}
                  aria-label={t("close")}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
              <div className="space-y-4 py-4">
                {isLoadingHistory && (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">{t("loadingHistory")}</p>
                  </div>
                )}
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-3",
                      msg.role === "user" && "flex-row-reverse"
                    )}
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
                        {msg.role === "assistant" ? (
                          <Sparkles className="h-3.5 w-3.5" />
                        ) : (
                          "NM"
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-sm",
                        msg.role === "assistant"
                          ? "bg-muted/50"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <MarkdownMessage content={msg.content} />
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {msg.suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => handlePromptClick(s)}
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
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-3"
                  >
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
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: i * 0.2,
                          }}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}

                {messages.length <= 1 && !isTyping && (
                  <div className="space-y-2 pt-4">
                    <Separator />
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("suggestedPrompts")}
                    </p>
                    <div className="flex flex-col gap-2">
                      {suggestedPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => handlePromptClick(prompt)}
                          className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/10"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t p-3 pb-[env(safe-area-inset-bottom)] lg:pb-3">
              <div className="mb-6 flex items-end gap-2 lg:mb-0">
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
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!input.trim()}
                    aria-label={t("send")}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
                <div className={cn(isRecording || isTranscribing ? "hidden" : "")}>
                  <VoiceInput
                    onTranscript={handleVoiceTranscript}
                    onRecordingStateChange={setIsRecording}
                    onTranscribingStateChange={setIsTranscribing}
                    onAudioLevel={setAudioLevel}
                    onRecordingTime={setRecordingSeconds}
                  />
                </div>
              </div>
            </div>
          </motion.div>
      )}
    </AnimatePresence>
  );
}

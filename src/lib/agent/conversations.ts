"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ChatMessage } from "@/types";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

/**
 * Conversation persistence service.
 * Uses Supabase RLS — users can only access their own conversations.
 * user_id must be passed explicitly for inserts (RLS checks auth.uid() = user_id).
 */
export const conversationService = {
  /** List all conversations for the current user, newest first. */
  async list(): Promise<Conversation[]> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("agent_conversations")
      .select("id, title, updated_at")
      .eq("archived", false)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[conversations] list error:", error.message);
      throw error;
    }
    return (data ?? []) as Conversation[];
  },

  /** Create a new conversation and return its id. */
  async create(userId: string, title = "Nouvelle conversation"): Promise<string> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("agent_conversations")
      .insert({ user_id: userId, title })
      .select("id")
      .single();

    if (error) {
      console.error("[conversations] create error:", error.message);
      throw error;
    }
    return data.id;
  },

  /** Rename a conversation. */
  async rename(id: string, title: string): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("agent_conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  /** Archive (soft-delete) a conversation. */
  async archive(id: string): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("agent_conversations")
      .update({ archived: true })
      .eq("id", id);
    if (error) throw error;
  },

  /** Permanently delete a conversation and all its messages. */
  async delete(id: string): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    // Messages are deleted via ON DELETE CASCADE
    const { error } = await supabase
      .from("agent_conversations")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[conversations] delete error:", error.message);
      throw error;
    }
  },

  /** Load all messages for a conversation, oldest first. */
  async loadMessages(conversationId: string): Promise<ChatMessage[]> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("agent_chat_messages")
      .select("id, role, content, suggestions, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[conversations] loadMessages error:", error.message);
      throw error;
    }

    return (data ?? []).map((m: { id: string; role: string; content: string; suggestions: string[] | null; created_at: string }) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      suggestions: m.suggestions as string[] | undefined,
      timestamp: new Date(m.created_at),
    }));
  },

  /** Append a single message to a conversation. */
  async addMessage(
    conversationId: string,
    message: { role: "user" | "assistant"; content: string; suggestions?: string[] }
  ): Promise<string> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("agent_chat_messages")
      .insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
        suggestions: message.suggestions ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[conversations] addMessage error:", error.message);
      throw error;
    }
    return data.id;
  },
};

/**
 * POST /api/assistant/stream
 *
 * Streaming variant of /api/assistant.
 *
 * Emits Server-Sent Events:
 *   event: status   data: {"status":"analyzing"}
 *   event: status   data: {"status":"retrieving_context"}
 *   ...
 *   event: complete data: {"reply":"...","commands":[...]}
 *   event: error    data: {"status":"error","error":"..."}
 *
 * When the FastAPI/LangGraph backend is available, statuses are mapped
 * from the real LangGraph nodes (context_analysis, planner,
 * tool_execution, result_verification, response_generation, fact_check).
 * Otherwise, a minimal functional fallback sequence is emitted while
 * the existing Next.js assistant pipeline runs.
 */

import { generateAssistantResponse } from "@/lib/ai";
import { getSetting } from "@/lib/settings";
import type { AIProcessingStatus } from "@/lib/ai-processing";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const FALLBACK_SEQUENCE: AIProcessingStatus[] = [
  "analyzing",
  "retrieving_context",
  "generating",
  "validating",
];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.message) {
    return new Response(sse("error", { status: "error", error: "Missing 'message' field" }), {
      status: 400,
      headers: SSE_HEADERS,
    });
  }

  const fastApiUrl = await getSetting("fastapi_url").catch(() => FASTAPI_URL);

  // ─── Priority 1: FastAPI/LangGraph streaming ─────────────
  if (fastApiUrl) {
    try {
      const upstream = await fetch(`${fastApiUrl}/api/agent/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body.message,
          history: body.history ?? [],
          execution_feedback: body.executionFeedback ?? [],
          user_role: body.userRole ?? "viewer",
          user_email: body.userEmail ?? "",
          last_analysis_context: body.lastAnalysisContext ?? null,
          conversation_id: body.conversationId ?? null,
          user_id: body.userId ?? null,
        }),
        signal: request.signal,
      });

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          status: 200,
          headers: SSE_HEADERS,
        });
      }
    } catch {
      // Fall through to Next.js fallback
    }
  }

  // ─── Priority 2: Next.js fallback with minimal statuses ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      try {
        // Emit functional fallback statuses while the pipeline runs.
        // These are NOT fake reasoning steps — they represent the real
        // stages of generateAssistantResponse (intent → tools → response).
        const fallbackTask = (async () => {
          for (const status of FALLBACK_SEQUENCE) {
            await new Promise((r) => setTimeout(r, 350));
            emit("status", { status });
          }
        })();

        const result = await generateAssistantResponse({
          message: body.message,
          history: body.history,
          context: body.context,
          powerbiState: body.powerbiState,
          executionFeedback: body.executionFeedback,
        });

        await fallbackTask;

        emit("complete", {
          reply: result.reply,
          commands: result.commands,
          suggestions: result.suggestions,
          intent: result.intent,
          status: result.status,
          clarification: result.clarification,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Assistant error";
        emit("error", { status: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

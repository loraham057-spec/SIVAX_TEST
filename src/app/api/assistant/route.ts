/**
 * POST /api/assistant
 *
 * Handles AI chat natively in Next.js (primary backend).
 * Uses LLM provider APIs (OpenAI/Anthropic) directly from server-side for:
 *   - LLM orchestration (OpenAI/Claude)
 *   - Natural language → structured command translation
 *   - Power BI filter application
 *   - ML forecast / anomaly triggers (delegates to Python satellite backend)
 *
 * Request body: { message: string, history?: ChatMessage[], context?: {...} }
 * Response:     { reply: string, action?: string, filters?: {...}, mlRequested?: boolean }
 */

import { apiError } from "../_lib/proxy";
import { generateAssistantResponse } from "@/lib/ai";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.message) {
    return apiError("Missing 'message' field");
  }

  try {
    const result = await generateAssistantResponse({
      message: body.message,
      history: body.history,
      context: body.context,
      powerbiState: body.powerbiState,
      executionFeedback: body.executionFeedback,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assistant error";
    return apiError(message, 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { runDhis2Analysis } from "@/lib/dhis2-analysis";
import type { Dhis2AnalysisRequest } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Manual DHIS2 analysis endpoint.
 *
 * Used only for analyses initiated outside the AI agent (e.g. the DHIS2
 * explorer). Agent-driven analyses are computed once server-side by the
 * FastAPI backend and delivered as a structured analysis_payload — they
 * never pass through this route (single-analysis architecture).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  let body: Partial<Dhis2AnalysisRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!body.question || typeof body.question !== "string") {
    return NextResponse.json({ error: "La question analytique est requise" }, { status: 400 });
  }

  try {
    const llmInterpretation = (body as { llmInterpretation?: string }).llmInterpretation;
    const analysis = await runDhis2Analysis(body, llmInterpretation ? { llmInterpretation } : undefined);
    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur d'analyse DHIS2";
    const timeout = /timeout|abort/i.test(message);
    return NextResponse.json(
      { error: timeout ? "Le serveur DHIS2 met trop de temps à répondre. Réduisez la portée de l'analyse." : message },
      { status: 502 },
    );
  }
}

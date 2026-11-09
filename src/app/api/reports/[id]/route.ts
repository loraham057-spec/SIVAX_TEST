/**
 * GET    /api/reports/[id] — fetch a report document.
 * PATCH  /api/reports/[id] — update (favorite flag).
 * DELETE /api/reports/[id] — delete a report.
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteReport, getReport, setReportFavorite } from "@/lib/report-engine/storage";
import { getReportUser } from "../_lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const document = await getReport(id, user.id);
  if (!document) return NextResponse.json({ error: "Rapport introuvable" }, { status: 404 });
  return NextResponse.json({ document });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  let body: { favorite?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  if (typeof body.favorite === "boolean") {
    await setReportFavorite(id, user.id, body.favorite);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  await deleteReport(id, user.id);
  return NextResponse.json({ ok: true });
}

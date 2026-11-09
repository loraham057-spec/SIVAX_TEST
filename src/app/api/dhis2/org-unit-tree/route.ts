import { NextRequest, NextResponse } from "next/server";
import { fetchOrgUnitWithChildren, isDhis2Configured } from "@/lib/dhis2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const parentId = searchParams.get("parentId");

  if (!parentId) {
    return NextResponse.json(
      { error: "Paramètre 'parentId' requis" },
      { status: 400 },
    );
  }

  try {
    const orgUnit = await fetchOrgUnitWithChildren(parentId);
    return NextResponse.json(orgUnit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchDataValues, isDhis2Configured } from "@/lib/dhis2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const dataSet = searchParams.get("dataSet");
  const period = searchParams.get("period");
  const orgUnit = searchParams.get("orgUnit");
  const children = searchParams.get("children") === "true";

  if (!dataSet || !period || !orgUnit) {
    return NextResponse.json(
      { error: "Paramètres requis: dataSet, period, orgUnit" },
      { status: 400 },
    );
  }

  try {
    const result = await fetchDataValues({ dataSet, period, orgUnit, children });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchDataSets, fetchDataSet, isDhis2Configured } from "@/lib/dhis2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const dataSet = await fetchDataSet(id);
      return NextResponse.json(dataSet);
    }

    const result = await fetchDataSets();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

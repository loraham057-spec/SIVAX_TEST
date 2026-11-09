import { NextResponse } from "next/server";
import { fetchSystemInfo, isDhis2Configured } from "@/lib/dhis2";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré. Ajoutez DHIS2_BASE_URL, DHIS2_USERNAME, DHIS2_PASSWORD dans .env" },
      { status: 503 },
    );
  }

  try {
    const info = await fetchSystemInfo();
    return NextResponse.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

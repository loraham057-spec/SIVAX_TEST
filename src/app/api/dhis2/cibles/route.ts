/**
 * GET /api/dhis2/cibles
 *
 * Données de population et cibles vaccinales (périodes annuelles YYYY).
 *
 * Paramètres :
 *   - orgUnitId : unité sélectionnée (défaut : racine nationale)
 *   - level     : niveau des descendants à détailler (2=province … 5=FOSA) ;
 *                 0 = l'unité seule
 *   - year      : année (défaut : année courante)
 *   - mode=trend&years=2023,2024,… : totaux annuels (population totale,
 *                 naissances vivantes) de l'unité elle-même, en un seul appel
 *
 * Stratégie : snapshot ETL (Supabase) d'abord, DHIS2 live sinon. Les réponses
 * sont mémorisées 10 min côté serveur : la démographie ne change pas à la minute.
 */

import { NextResponse } from "next/server";
import { dhis2Get, isDhis2Configured } from "@/lib/dhis2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ETL_SOURCE_LABEL, fetchDescendants, fetchLastSync, fetchOrgUnit } from "@/lib/etl-analytics";

export const dynamic = "force-dynamic";

const ROOT_OU = process.env.DHIS2_ROOT_OU ?? "ymGeqzoPhN3";
const LIVE_SOURCE_LABEL = "DHIS2 — SNIS RDC (live)";
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Data elements de population/cibles dans DHIS2 SNIS RDC. */
const POP_DATA_ELEMENTS = [
  { id: "WLSKVyA8LoY", label: "Population totale", shortLabel: "popTotale", measured: true },
  { id: "gDnbubwzuts", label: "Naissances vivantes", shortLabel: "livebirths", measured: true },
  { id: "gKPWbBQPARu", label: "Cible vaccinale attendue", shortLabel: "cibleVaccinale", measured: true },
  { id: "x11HLiggMXS", label: "Femmes enceintes", shortLabel: "femmesEnceintes", measured: true },
  { id: "VrwYlqEHl9S", label: "Population cible Accouchement", shortLabel: "cibleAccouchement", measured: true },
  { id: "IBGIRfSP2Jg", label: "Population 0-11 mois dénombrée", shortLabel: "pop011", measured: true },
  { id: "dCBjhC2T98U", label: "Population 0-12 mois dénombrée", shortLabel: "pop012", measured: true },
  { id: "xG7yuRfm4Xy", label: "Population 0-5 ans", shortLabel: "pop05", measured: true },
  { id: "y9VVUAUMYQZ", label: "Population 0-4 ans - Masculin", shortLabel: "pop04M", measured: true },
  { id: "bg69hyC1ufp", label: "Population 0-4 ans - Féminin", shortLabel: "pop04F", measured: true },
  { id: "jG1u3p3LwzY", label: "Population 5-9 ans - Féminin", shortLabel: "pop59F", measured: true },
  { id: "wWUcvf2KNPc", label: "Population 5-9 ans - Masculin", shortLabel: "pop59M", measured: true },
  { id: "TjUCEbelXqi", label: "Population 10-14 ans - Féminin", shortLabel: "pop1014F", measured: true },
  { id: "HERa1PYydgt", label: "Population 10-14 ans - Masculin", shortLabel: "pop1014M", measured: true },
  { id: "vUS6lPL5gLb", label: "Population 15-19 ans - Féminin", shortLabel: "pop1519F", measured: true },
  { id: "TO1gFP0JTQh", label: "Population 15-19 ans - Masculin", shortLabel: "pop1519M", measured: true },
] as const;

const TREND_DES = POP_DATA_ELEMENTS.slice(0, 2); // popTotale, livebirths
const DE_BY_ID = new Map<string, (typeof POP_DATA_ELEMENTS)[number]>(POP_DATA_ELEMENTS.map((d) => [d.id, d]));

interface CibleRow {
  orgUnitId: string;
  orgUnitName: string;
  values: Record<string, number | null>;
}

interface CiblesResult {
  rows: CibleRow[];
  dataElements: { id: string; label: string; shortLabel: string; measured: boolean }[];
}

type TrendResult = Record<string, { popTotale: number | null; livebirths: number | null }>;

const cache = new Map<string, { expiresAt: number; body: unknown }>();

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.body as T);
  return compute().then((body) => {
    cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
    return body;
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgUnitId = url.searchParams.get("orgUnitId") ?? ROOT_OU;
  const level = Number(url.searchParams.get("level") ?? 2) || 0;
  const year = url.searchParams.get("year") ?? String(new Date().getFullYear());
  const mode = url.searchParams.get("mode");

  try {
    if (mode === "trend") {
      const years = (url.searchParams.get("years") ?? year).split(",").filter((y) => /^\d{4}$/.test(y));
      const body = await cached(`trend:${orgUnitId}:${years.join(",")}`, () => readTrend(orgUnitId, years));
      return NextResponse.json(body);
    }
    const body = await cached(`detail:${orgUnitId}:${level}:${year}`, () => readDetail(orgUnitId, level, year));
    if ("error" in body) return NextResponse.json(body, { status: body.status });
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function readDetail(orgUnitId: string, level: number, year: string) {
  const supa = await readFromSupabase(orgUnitId, level, year);
  if (supa) {
    const syncedAt = await fetchLastSync().catch(() => null);
    return { source: ETL_SOURCE_LABEL, syncedAt, year, level, orgUnitId, ...supa };
  }
  if (!(await isDhis2Configured())) {
    return { error: "DHIS2 non configuré et Supabase vide", status: 503 as const };
  }
  const live = await readFromDhis2(orgUnitId, level, year);
  return { source: LIVE_SOURCE_LABEL, year, level, orgUnitId, ...live };
}

async function readTrend(orgUnitId: string, years: string[]): Promise<{ source: string; years: TrendResult }> {
  const result: TrendResult = Object.fromEntries(years.map((y) => [y, { popTotale: null, livebirths: null }]));
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from("fact_indicator_values")
    .select("indicator_id,period,value")
    .eq("org_unit_id", orgUnitId)
    .in("indicator_id", TREND_DES.map((d) => d.id))
    .in("period", years);
  if (data && data.length > 0) {
    for (const f of data) {
      const de = DE_BY_ID.get(f.indicator_id);
      if (de) result[f.period][de.shortLabel as "popTotale" | "livebirths"] = Number(f.value);
    }
    return { source: ETL_SOURCE_LABEL, years: result };
  }

  if (!(await isDhis2Configured())) return { source: LIVE_SOURCE_LABEL, years: result };
  const analytics = await dhis2Get<{ rows: string[][] }>(
    `/api/analytics.json?dimension=dx:${TREND_DES.map((d) => d.id).join(";")}` +
      `&dimension=pe:${years.join(";")}&dimension=ou:${orgUnitId}&skipMeta=true&paging=false`,
    0,
    25_000,
  );
  for (const row of analytics.rows ?? []) {
    const [dx, pe, , raw] = row;
    const de = DE_BY_ID.get(dx);
    const num = Number(raw);
    if (de && result[pe] && Number.isFinite(num)) result[pe][de.shortLabel as "popTotale" | "livebirths"] = num;
  }
  return { source: LIVE_SOURCE_LABEL, years: result };
}

/** Units to detail: the descendants of `orgUnitId` at `level`, or the unit itself. */
async function resolveUnits(orgUnitId: string, level: number) {
  const parent = await fetchOrgUnit(orgUnitId);
  if (level === 0 || (parent?.level !== null && parent?.level !== undefined && level <= parent.level)) {
    return [parent ?? { id: orgUnitId, name: orgUnitId, level: null }];
  }
  return fetchDescendants(orgUnitId, level, parent?.level ?? undefined);
}

async function readFromSupabase(orgUnitId: string, level: number, year: string): Promise<CiblesResult | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const units = await resolveUnits(orgUnitId, level);
    if (units.length === 0) return null;
    const nameMap = new Map<string, string>(units.map((u) => [u.id, u.name ?? u.id]));

    const rowMap = new Map<string, CibleRow>();
    const OU_CHUNK = 200;
    for (let i = 0; i < units.length; i += OU_CHUNK) {
      const ids = units.slice(i, i + OU_CHUNK).map((u) => u.id);
      const { data, error } = await supabase
        .from("fact_indicator_values")
        .select("indicator_id,org_unit_id,value")
        .in("indicator_id", POP_DATA_ELEMENTS.map((de) => de.id))
        .eq("period", year)
        .in("org_unit_id", ids)
        .range(0, 9999);
      if (error) return null;
      for (const fact of data ?? []) {
        const de = DE_BY_ID.get(fact.indicator_id);
        if (!de) continue;
        const row: CibleRow = rowMap.get(fact.org_unit_id) ?? {
          orgUnitId: fact.org_unit_id,
          orgUnitName: nameMap.get(fact.org_unit_id) ?? fact.org_unit_id,
          values: {},
        };
        row.values[de.shortLabel] = Number(fact.value);
        rowMap.set(fact.org_unit_id, row);
      }
    }
    if (rowMap.size === 0) return null;
    return { rows: [...rowMap.values()], dataElements: [...POP_DATA_ELEMENTS] };
  } catch {
    return null;
  }
}

async function readFromDhis2(orgUnitId: string, level: number, year: string): Promise<CiblesResult> {
  const dx = POP_DATA_ELEMENTS.map((de) => de.id).join(";");
  const ouDim = level > 0 ? `${orgUnitId};LEVEL-${level}` : orgUnitId;
  const analytics = await dhis2Get<{
    rows: string[][];
    metaData: { items: Record<string, { name: string }>; dimensions: Record<string, string[]> };
  }>(
    `/api/analytics.json?dimension=dx:${dx}&dimension=pe:${year}&dimension=ou:${ouDim}&displayProperty=NAME&paging=false`,
    0,
    25_000,
  );

  const items = analytics.metaData?.items ?? {};
  const rowMap = new Map<string, CibleRow>();
  for (const [dxId, , ouId, val] of analytics.rows ?? []) {
    const num = Number(val);
    const de = DE_BY_ID.get(dxId);
    if (!Number.isFinite(num) || !de) continue;
    // With `X;LEVEL-n` DHIS2 also returns X itself; keep only the detail level.
    if (level > 0 && ouId === orgUnitId) continue;
    const row: CibleRow = rowMap.get(ouId) ?? { orgUnitId: ouId, orgUnitName: items[ouId]?.name ?? ouId, values: {} };
    row.values[de.shortLabel] = num;
    rowMap.set(ouId, row);
  }
  return { rows: [...rowMap.values()], dataElements: [...POP_DATA_ELEMENTS] };
}

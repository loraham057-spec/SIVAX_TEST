interface GeoNameMapping {
  dhis2Names: string[];
  geoJsonName: string;
}

const PROVINCE_MAPPINGS: GeoNameMapping[] = [
  { dhis2Names: ["kinshasa"], geoJsonName: "Kinshasa" },
  { dhis2Names: ["kongo-central", "bas-congo", "kongo central"], geoJsonName: "Kongo-Central" },
  { dhis2Names: ["kwango"], geoJsonName: "Kwango" },
  { dhis2Names: ["kwilu"], geoJsonName: "Kwilu" },
  { dhis2Names: ["mai-ndombe", "maï-ndombe", "maindombe"], geoJsonName: "Mai-Ndombe" },
  { dhis2Names: ["equateur", "équateur"], geoJsonName: "Equateur" },
  { dhis2Names: ["sud-ubangi"], geoJsonName: "Sud-Ubangi" },
  { dhis2Names: ["nord-ubangi"], geoJsonName: "Nord-Ubangi" },
  { dhis2Names: ["mongala"], geoJsonName: "Mongala" },
  { dhis2Names: ["tshuapa"], geoJsonName: "Tshuapa" },
  { dhis2Names: ["tshopo"], geoJsonName: "Tshopo" },
  { dhis2Names: ["bas-uele"], geoJsonName: "Bas-Uele" },
  { dhis2Names: ["haut-uele"], geoJsonName: "Haut-Uele" },
  { dhis2Names: ["ituri"], geoJsonName: "Ituri" },
  { dhis2Names: ["nord-kivu"], geoJsonName: "Nord-Kivu" },
  { dhis2Names: ["sud-kivu"], geoJsonName: "Sud-Kivu" },
  { dhis2Names: ["maniema"], geoJsonName: "Maniema" },
  { dhis2Names: ["haut-katanga"], geoJsonName: "Haut-Katanga" },
  { dhis2Names: ["lualaba"], geoJsonName: "Lualaba" },
  { dhis2Names: ["haut-lomami"], geoJsonName: "Haut-Lomami" },
  { dhis2Names: ["tanganyika"], geoJsonName: "Tanganyika" },
  { dhis2Names: ["lomami"], geoJsonName: "Lomami" },
  { dhis2Names: ["kasai-oriental", "kasai oriental", "kasaï-oriental"], geoJsonName: "Kasai-Oriental" },
  { dhis2Names: ["sankuru"], geoJsonName: "Sankuru" },
  { dhis2Names: ["kasai-central", "kasai central", "kasaï-central"], geoJsonName: "Kasai-Central" },
  { dhis2Names: ["kasai", "kasaï"], geoJsonName: "Kasai" },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\s-]+/g, "-");
}

export function resolveGeoJsonName(dhis2Name: string): string | null {
  // DHIS2 returns names like "bu Bas Uele Province" — strip the short code prefix
  // and the trailing "Province" suffix to get the clean province name
  let cleaned = dhis2Name;
  // Remove leading short code (1-3 lowercase letters followed by a space)
  cleaned = cleaned.replace(/^[a-z]{1,3}\s+/, "");
  // Remove trailing " Province"
  cleaned = cleaned.replace(/\s+Province$/i, "");

  const normalized = normalize(cleaned);
  for (const mapping of PROVINCE_MAPPINGS) {
    if (mapping.dhis2Names.some((n) => normalize(n) === normalized)) {
      return mapping.geoJsonName;
    }
  }
  return null;
}

export function buildGeoDataMap(
  rows: string[][],
  metaData: { items: Record<string, { name: string }>; dimensions: Record<string, string[]> },
  valueColumnIndex: number,
  ouColumnIndex: number,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const row of rows) {
    const ouId = row[ouColumnIndex];
    const value = Number(row[valueColumnIndex]);
    if (!Number.isFinite(value)) continue;

    const dhis2Name = metaData.items[ouId]?.name ?? ouId;
    const geoName = resolveGeoJsonName(dhis2Name);
    if (geoName) {
      result.set(geoName, value);
    }
  }

  return result;
}

export const RDC_PROVINCE_NAMES: string[] = PROVINCE_MAPPINGS.map(
  (m) => m.geoJsonName,
);

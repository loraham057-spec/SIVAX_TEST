"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { resolveGeoJsonName } from "@/lib/geo-lookup";
import { defaultSequentialScale, LEGEND_COLORS } from "@/lib/map-color-scale";
import { formatCoveragePercent, formatDhis2Period, formatDhis2PeriodRange } from "@/lib/dhis2-format";
import { latestByOrgUnit } from "@/lib/dhis2-analytics";
import type { Dhis2AnalyticsResult } from "@/types";

export type MapStatus = "good" | "warning" | "critical" | "suspect" | null;

const STATUS_COLORS: Record<Exclude<MapStatus, null>, string> = {
  good: "#16A34A",
  warning: "#F59E0B",
  critical: "#DC2626",
  suspect: "#7C3AED",
};

interface Dhis2ChoroplethMapProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  /**
   * Threshold status of a value. When given, units are colored good /
   * warning / critical (handles "lower is better" indicators) instead of the
   * neutral quantile scale.
   */
  status?: (value: number) => MapStatus;
  /** Period caption replacing the one derived from the data (e.g. a cumulative range). */
  periodLabel?: string;
  /** Hide the built-in title row when the map sits in a titled card. */
  hideHeader?: boolean;
  /** Value formatter for tooltips and legend (default: percentage). */
  formatValue?: (value: number) => string;
  /** Extra tooltip HTML for a unit (caller escapes any user data). */
  describe?: (ouId: string) => string | null;
}

export function Dhis2ChoroplethMap({
  result: mapResult,
  loading: mapLoading,
  status,
  periodLabel,
  hideHeader,
  formatValue = formatCoveragePercent,
  describe,
}: Dhis2ChoroplethMapProps) {
  const t = useTranslations("dhis2");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoJsonLayerRef = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [legendInfo, setLegendInfo] = useState<{
    min: number;
    max: number;
    indicatorName: string;
  } | null>(null);

  const [geoError, setGeoError] = useState<string | null>(null);

  // Load GeoJSON once
  useEffect(() => {
    const startedAt = Date.now();
    fetch("/geo/rdc_provinces.geojson")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: GeoJSON.FeatureCollection) => setGeoData(data))
      .catch((err: unknown) => {
        // Swallowing this left the map permanently blank with no explanation.
        const cause = err instanceof Error ? err.message : String(err);
        console.error(
          `[map] GeoJSON load failed after ${Date.now() - startedAt}ms — ${cause}`,
        );
        setGeoError(t("mapLoadError"));
      });
  }, [t]);

  const { dataMap, periodMap, ouMap, indicatorName, colorScale, periodCaption } = useMemo(() => {
    if (!mapResult?.rows || !mapResult?.metaData) {
      return {
        dataMap: new Map<string, number>(),
        periodMap: new Map<string, string>(),
        ouMap: new Map<string, string>(),
        indicatorName: "",
        colorScale: null as ((v: number) => string) | null,
        periodCaption: null as string | null,
      };
    }

    const dxItems = mapResult.metaData.dimensions.dx ?? [];
    const firstDx = dxItems[0] ?? mapResult.rows[0]?.[0];
    const indicatorLabel = firstDx
      ? mapResult.metaData.items[firstDx]?.name ?? firstDx
      : "";

    // Latest complete value of each unit — the same rule as the rankings and
    // tables next to the map (a unit without the most recent month keeps its
    // previous value instead of turning grey).
    const dMap = new Map<string, number>();
    const pMap = new Map<string, string>();
    const oMap = new Map<string, string>();
    for (const { ouId, name, period, value } of latestByOrgUnit(mapResult, firstDx)) {
      const geoName = resolveGeoJsonName(name);
      if (!geoName) continue;
      dMap.set(geoName, value);
      pMap.set(geoName, period);
      oMap.set(geoName, ouId);
    }

    const periods = [...new Set(pMap.values())].sort();
    const caption = periods.length === 0
      ? null
      : periods.length === 1
        ? formatDhis2Period(periods[0])
        : formatDhis2PeriodRange(periods[0], periods[periods.length - 1]);

    const values = Array.from(dMap.values());
    const scale = values.length === 0
      ? null
      : status
        ? (v: number) => {
            const s = status(v);
            return s ? STATUS_COLORS[s] : "#e5e7eb";
          }
        : defaultSequentialScale(values);

    return { dataMap: dMap, periodMap: pMap, ouMap: oMap, indicatorName: indicatorLabel, colorScale: scale, periodCaption: caption };
  }, [mapResult, status]);
  const caption = periodLabel ?? periodCaption;
  const hasSuspect = useMemo(
    () => !!status && [...dataMap.values()].some((v) => status(v) === "suspect"),
    [dataMap, status],
  );

  // The base map only has provinces: below the national level the units are
  // zones / aires and cannot be drawn.
  const notProvinces = !mapLoading && (mapResult?.rows.length ?? 0) > 0 && dataMap.size === 0;

  // Initialize Leaflet map once (container is always rendered)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Center on the actual centroid of the RDC GeoJSON bbox
    // (lon [12.2, 31.3], lat [-13.5, 5.4] → center ~[-4.03, 21.74])
    const map = L.map(containerRef.current, {
      center: [-4.03, 21.74],
      zoom: 5,
      minZoom: 4,
      maxZoom: 10,
      scrollWheelZoom: true,
      // L attribution est une obligation de licence pour les tuiles
      // OpenStreetMap, pas un ornement : elle etait definie plus bas mais le
      // controle qui l affiche etait desactive, donc elle n apparaissait nulle
      // part. Le controle Leaflet est discret, en bas a droite.
      attributionControl: true,
      maxBounds: L.latLngBounds(L.latLng(-13.5, 12.2), L.latLng(5.4, 31.3)),
      maxBoundsViscosity: 0.8,
    });

    // CARTO a ferme ses tuiles publiques : basemaps.cartocdn.com repond
    // toujours 200 avec une image PNG, mais c est une tuile filigranee
    // "API KEY REQUIRED" — le fond de carte devenait illisible sans qu aucune
    // erreur ne soit levee. Bascule sur les tuiles OpenStreetMap, qui ne
    // demandent pas de cle.
    //
    // Pour retrouver le fond clair de CARTO, il faut un compte et une cle :
    // https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=...
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Fix tile rendering after layout settles
    const sizeTimer = setTimeout(() => {
      // Guard: the map may have been removed (fast unmount) before the
      // timer fires, in which case invalidateSize() would throw
      // "Cannot read properties of undefined (reading '_leaflet_pos')".
      if (mapRef.current === map && containerRef.current) {
        map.invalidateSize();
      }
    }, 100);

    return () => {
      clearTimeout(sizeTimer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit map to GeoJSON bounds once, when the GeoJSON first loads.
  // We don't refit on every data change — that would yank the user's pan/zoom
  // every time they switch indicator or filter.
  const hasFittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geoData || hasFittedRef.current) return;

    try {
      const tmpLayer = L.geoJSON(geoData);
      const bounds = tmpLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 7 });
        hasFittedRef.current = true;
      }
    } catch {
      // ignore
    }
  }, [geoData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geoData) return;

    if (geoJsonLayerRef.current) {
      map.removeLayer(geoJsonLayerRef.current);
      geoJsonLayerRef.current = null;
    }

    const values = Array.from(dataMap.values());
    if (values.length > 0) {
      setLegendInfo({
        min: Math.min(...values),
        max: Math.max(...values),
        indicatorName,
      });
    } else {
      setLegendInfo(null);
    }

    const getStyle = (feature?: GeoJSON.Feature): L.PathOptions => {
      const name = feature?.properties?.["name"] as string | undefined;
      const value = name ? dataMap.get(name) : undefined;
      const fillColor =
        value !== undefined && colorScale
          ? colorScale(value)
          : "#e5e7eb";
      return {
        fillColor,
        weight: 1,
        opacity: 1,
        color: "#94a3b8",
        fillOpacity: 0.75,
      };
    };

    const layer = L.geoJSON(geoData, {
      style: getStyle,
      onEachFeature: (feature, lyr) => {
        const name = feature.properties?.["name"] as string;
        const value = dataMap.get(name);
        const displayValue =
          value !== undefined ? formatValue(value) : t("noData");
        const unitPeriod = periodLabel ?? (periodMap.get(name) ? formatDhis2Period(periodMap.get(name)!) : "");
        const suspect = value !== undefined && status?.(value) === "suspect" ? ` — ${t("mapStatus.suspect")}` : "";
        const ouId = ouMap.get(name);
        const extraHtml = ouId && describe ? describe(ouId) : null;
        const extra = extraHtml ? `<br/>${extraHtml}` : "";
        const tooltipHtml = unitPeriod
          ? `<strong>${name}</strong><br/>${indicatorName || t("value")}: ${displayValue}${suspect}${extra}<br/><span style="font-size:10px;color:#64748b">${unitPeriod}</span>`
          : `<strong>${name}</strong><br/>${indicatorName || t("value")}: ${displayValue}${suspect}${extra}`;
        lyr.bindTooltip(
          tooltipHtml,
          { sticky: true, className: "dhis2-map-tooltip" },
        );
        lyr.on("mouseover", () => {
          (lyr as L.Path).setStyle({ weight: 2, color: "#174A8B", fillOpacity: 0.9 });
        });
        lyr.on("mouseout", () => {
          (lyr as L.Path).setStyle(getStyle(feature));
        });
      },
    });

    layer.addTo(map);
    geoJsonLayerRef.current = layer;

    // Invalidate size after adding layer
    const layerTimer = setTimeout(() => {
      if (mapRef.current === map && containerRef.current) {
        map.invalidateSize();
      }
    }, 50);
    // Clear the timer if deps change before it fires.
    return () => clearTimeout(layerTimer);
  }, [geoData, dataMap, periodMap, ouMap, colorScale, indicatorName, periodLabel, status, formatValue, describe, t]);

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm">
      {!hideHeader && (
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold">{t("mapTitle")}</h3>
            {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
          </div>
          {indicatorName && (
            <span className="text-xs text-muted-foreground line-clamp-1 ml-2 max-w-[60%]">
              {indicatorName}
            </span>
          )}
        </div>
      )}
      <div className="relative flex-1 w-full rounded-lg border border-border/50 overflow-hidden min-h-[256px]">
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ zIndex: 0 }}
        />
        {mapLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">{t("mapLoading")}</span>
            </div>
          </div>
        )}
        {geoError && (
          <div className="absolute bottom-2 left-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive backdrop-blur-sm">
            {geoError}
          </div>
        )}
        {!geoError && notProvinces && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 p-6 text-center backdrop-blur-sm">
            <span className="max-w-xs text-xs text-muted-foreground">{t("mapProvincesOnly")}</span>
          </div>
        )}
        {!geoError && !mapLoading && !notProvinces && dataMap.size === 0 && (
          <div className="absolute bottom-2 left-2 rounded-lg bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            {t("noGeoData")}
          </div>
        )}
      </div>
      {legendInfo && status && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(["good", "warning", "critical", ...(hasSuspect ? (["suspect"] as const) : [])] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS[s] }} />
              {t(`mapStatus.${s}`)}
            </span>
          ))}
          <span className="ml-auto font-medium tabular-nums">
            {formatValue(legendInfo.min)} – {formatValue(legendInfo.max)}
          </span>
        </div>
      )}
      {legendInfo && !status && (
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("mapLow")}</span>
          <div className="flex h-3 flex-1 overflow-hidden rounded-full">
            {LEGEND_COLORS.map((c, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{t("mapHigh")}</span>
          <span className="ml-2 text-xs font-medium tabular-nums">
            {formatValue(legendInfo.min)} – {formatValue(legendInfo.max)}
          </span>
        </div>
      )}
    </div>
  );
}

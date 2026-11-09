/**
 * Chart Engine — converts a ReportChart definition into a normalized
 * geometric model, then renders it as vector SVG.
 *
 * The same model feeds the web preview, the standalone HTML export and
 * the PDF renderer (which redraws the geometry with vector primitives),
 * so charts are never screenshots.
 */

import type { ReportChart } from "./types";
import type { ReportTheme } from "./templates";

export interface ChartPoint {
  /** Normalized 0..1 (left → right). */
  x: number;
  /** Normalized 0..1 (bottom → top). */
  y: number;
  value: number | null;
}

export interface ChartModelSeries {
  name: string;
  color: string;
  points: ChartPoint[];
}

export interface DonutSegment {
  label: string;
  value: number;
  frac: number;
  color: string;
}

export interface ChartModel {
  type: ReportChart["type"];
  title: string;
  subtitle?: string;
  source?: string;
  categories: string[];
  yTicks: { value: number; label: string; t: number }[];
  series: ChartModelSeries[];
  segments: DonutSegment[];
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function formatChartValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k`;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

export function buildChartModel(chart: ReportChart, theme: ReportTheme): ChartModel {
  const palette = theme.colors.chartPalette;
  const model: ChartModel = {
    type: chart.type,
    title: chart.title,
    subtitle: chart.subtitle,
    source: chart.source,
    categories: chart.categories,
    yTicks: [],
    series: [],
    segments: [],
  };

  if (chart.type === "donut") {
    const values = chart.categories.map((label, i) => ({
      label,
      value: chart.series[0]?.data[i] ?? 0,
    }));
    const total = values.reduce((s, v) => s + (v.value ?? 0), 0) || 1;
    model.segments = values.map((v, i) => ({
      label: v.label,
      value: v.value ?? 0,
      frac: (v.value ?? 0) / total,
      color: palette[i % palette.length],
    }));
    return model;
  }

  const allValues = chart.series.flatMap((s) => s.data).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = niceMax(Math.max(...(allValues.length ? allValues : [1])));
  const tickCount = 4;
  model.yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const value = (max / tickCount) * i;
    return { value, label: formatChartValue(value), t: i / tickCount };
  });

  const n = Math.max(chart.categories.length, 1);
  model.series = chart.series.map((s, si) => ({
    name: s.name,
    color: palette[si % palette.length],
    points: s.data.map((v, i) => ({
      x: n === 1 ? 0.5 : i / (n - 1),
      y: v === null ? 0 : Math.min(1, v / max),
      value: v,
    })),
  }));
  return model;
}

/* ─────────────────────────── SVG rendering ─────────────────────────── */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface SvgOptions {
  width?: number;
  height?: number;
}

export function renderChartSvg(model: ChartModel, theme: ReportTheme, opts: SvgOptions = {}): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 300;
  if (model.type === "donut") return renderDonutSvg(model, theme, width, height);
  return renderAxesChartSvg(model, theme, width, height);
}

function renderAxesChartSvg(model: ChartModel, theme: ReportTheme, width: number, height: number): string {
  const pad = { top: 14, right: 16, bottom: 34, left: 52 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const font = "font-family=\"Helvetica, Arial, sans-serif\"";
  const parts: string[] = [];

  // Grid + y labels
  for (const tick of model.yTicks) {
    const y = pad.top + h - tick.t * h;
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + w}" y2="${y}" stroke="${theme.colors.border}" stroke-width="1"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="${theme.colors.muted}" ${font}>${esc(tick.label)}</text>`);
  }

  // X labels (skip some when crowded)
  const n = model.categories.length;
  const step = Math.max(1, Math.ceil(n / 8));
  model.categories.forEach((label, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x = pad.left + (n === 1 ? 0.5 : i / (n - 1)) * w;
    parts.push(`<text x="${x}" y="${height - 16}" text-anchor="middle" font-size="10" fill="${theme.colors.muted}" ${font}>${esc(label)}</text>`);
  });

  if (model.type === "bar") {
    const groups = n;
    const seriesCount = Math.max(model.series.length, 1);
    const groupWidth = w / Math.max(groups, 1);
    const barWidth = Math.min(38, (groupWidth * 0.7) / seriesCount);
    model.series.forEach((s, si) => {
      s.points.forEach((p, i) => {
        if (p.value === null) return;
        const cx = pad.left + (i + 0.5) * groupWidth;
        const x = cx - (seriesCount * barWidth) / 2 + si * barWidth;
        const barH = p.y * h;
        parts.push(`<rect x="${x.toFixed(1)}" y="${(pad.top + h - barH).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${s.color}" rx="2"/>`);
      });
    });
    // Re-draw x labels centered per bar group for bar charts
  } else {
    // line / area
    model.series.forEach((s) => {
      const coords = s.points
        .filter((p) => p.value !== null)
        .map((p) => `${(pad.left + p.x * w).toFixed(1)},${(pad.top + h - p.y * h).toFixed(1)}`);
      if (coords.length === 0) return;
      if (model.type === "area") {
        const first = coords[0].split(",")[0];
        const last = coords[coords.length - 1].split(",")[0];
        parts.push(`<polygon points="${first},${pad.top + h} ${coords.join(" ")} ${last},${pad.top + h}" fill="${s.color}" opacity="0.15"/>`);
      }
      parts.push(`<polyline points="${coords.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
      coords.forEach((c) => {
        const [x, y] = c.split(",");
        parts.push(`<circle cx="${x}" cy="${y}" r="2.5" fill="${s.color}"/>`);
      });
    });
  }

  // Legend (multi-series only)
  if (model.series.length > 1) {
    let lx = pad.left;
    const ly = height - 4;
    model.series.forEach((s) => {
      parts.push(`<rect x="${lx}" y="${ly - 8}" width="9" height="9" fill="${s.color}" rx="2"/>`);
      parts.push(`<text x="${lx + 13}" y="${ly}" font-size="10" fill="${theme.colors.text}" ${font}>${esc(s.name)}</text>`);
      lx += 13 + s.name.length * 5.6 + 18;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(model.title)}">${parts.join("")}</svg>`;
}

function renderDonutSvg(model: ChartModel, theme: ReportTheme, width: number, height: number): string {
  const cx = height / 2;
  const cy = height / 2;
  const r = height / 2 - 16;
  const inner = r * 0.62;
  const font = "font-family=\"Helvetica, Arial, sans-serif\"";
  const parts: string[] = [];
  let angle = -Math.PI / 2;

  for (const seg of model.segments) {
    const a0 = angle;
    const a1 = angle + seg.frac * Math.PI * 2;
    angle = a1;
    if (seg.frac <= 0) continue;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`;
    parts.push(
      `<path d="M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z" fill="${seg.color}" stroke="${theme.colors.background}" stroke-width="1.5"/>`,
    );
  }

  // Legend
  const lx = height + 12;
  model.segments.slice(0, 8).forEach((seg, i) => {
    const y = 22 + i * 20;
    parts.push(`<rect x="${lx}" y="${y - 9}" width="10" height="10" fill="${seg.color}" rx="2"/>`);
    parts.push(
      `<text x="${lx + 16}" y="${y}" font-size="11" fill="${theme.colors.text}" ${font}>${esc(seg.label)} — ${formatChartValue(seg.value)} (${(seg.frac * 100).toFixed(1)}%)</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(model.title)}">${parts.join("")}</svg>`;
}

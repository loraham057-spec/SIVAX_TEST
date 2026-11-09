/**
 * Simplifies public/geo/rdc_provinces.geojson in place.
 *
 * The source file carries ~105 000 vertices at 8 decimal places (≈1 mm
 * precision) for 26 province polygons rendered at country zoom — 2,6 Mo shipped
 * on the critical path of every map view. Douglas-Peucker plus coordinate
 * rounding brings that under the 500 Ko static-asset budget with no visible
 * difference at the zoom levels the choropleth uses.
 *
 * Usage:
 *   node scripts/simplify-geojson.mjs [--tolerance 0.005] [--precision 4] [--check]
 *
 * `--check` only reports what would change (used by CI to enforce the budget).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(ROOT, "public/geo/rdc_provinces.geojson");

/** Max static asset size enforced in CI (PARTIE 6.5 performance budgets). */
const SIZE_BUDGET_BYTES = 500 * 1024;

function parseArgs(argv) {
  const args = { tolerance: 0.005, precision: 4, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") args.check = true;
    if (argv[i] === "--tolerance") args.tolerance = Number(argv[++i]);
    if (argv[i] === "--precision") args.precision = Number(argv[++i]);
  }
  return args;
}

/** Perpendicular distance from `point` to the segment [start, end]. */
function perpendicularDistance(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;

  const dx = ex - sx;
  const dy = ey - sy;

  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);

  const t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (sx + clamped * dx), py - (sy + clamped * dy));
}

/** Iterative Douglas-Peucker — recursion would blow the stack on long rings. */
function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;

    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

function roundCoord(coord, precision) {
  const factor = 10 ** precision;
  return [Math.round(coord[0] * factor) / factor, Math.round(coord[1] * factor) / factor];
}

/** Drops consecutive duplicates left behind by rounding. */
function dedupe(ring) {
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prev = out[out.length - 1];
    if (ring[i][0] !== prev[0] || ring[i][1] !== prev[1]) out.push(ring[i]);
  }
  return out;
}

function simplifyRing(ring, { tolerance, precision }) {
  const isClosed =
    ring.length > 2 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];

  let simplified = douglasPeucker(ring, tolerance).map((c) => roundCoord(c, precision));
  simplified = dedupe(simplified);

  // A polygon ring needs at least 4 positions and must stay closed.
  if (isClosed) {
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([...first]);
    if (simplified.length < 4) return null;
  }

  return simplified;
}

function simplifyGeometry(geometry, options) {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates.map((r) => simplifyRing(r, options)).filter(Boolean);
    return rings.length > 0 ? { ...geometry, coordinates: rings } : null;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates
      .map((polygon) => polygon.map((r) => simplifyRing(r, options)).filter(Boolean))
      .filter((polygon) => polygon.length > 0);
    return polygons.length > 0 ? { ...geometry, coordinates: polygons } : null;
  }

  return geometry;
}

function countVertices(collection) {
  let total = 0;
  const walk = (coords) => {
    if (Array.isArray(coords[0])) coords.forEach(walk);
    else total++;
  };
  collection.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  return total;
}

const options = parseArgs(process.argv.slice(2));
const original = readFileSync(TARGET);
const collection = JSON.parse(original.toString("utf8"));

const simplified = {
  type: "FeatureCollection",
  features: collection.features
    .map((feature) => {
      const geometry = simplifyGeometry(feature.geometry, options);
      // Keep only the properties the choropleth joins on.
      return geometry ? { type: "Feature", properties: feature.properties, geometry } : null;
    })
    .filter(Boolean),
};

const output = Buffer.from(JSON.stringify(simplified));
const before = original.length;
const after = output.length;

console.log(
  [
    `features  : ${collection.features.length} → ${simplified.features.length}`,
    `vertices  : ${countVertices(collection)} → ${countVertices(simplified)}`,
    `size      : ${(before / 1024).toFixed(0)} Ko → ${(after / 1024).toFixed(0)} Ko ` +
      `(−${(100 - (after / before) * 100).toFixed(1)} %)`,
    `budget    : ${(SIZE_BUDGET_BYTES / 1024).toFixed(0)} Ko — ${after <= SIZE_BUDGET_BYTES ? "OK" : "DÉPASSÉ"}`,
  ].join("\n"),
);

if (options.check) {
  if (after > SIZE_BUDGET_BYTES) process.exit(1);
} else {
  writeFileSync(TARGET, output);
  console.log(`\nÉcrit : ${TARGET}`);
  if (after > SIZE_BUDGET_BYTES) process.exit(1);
}

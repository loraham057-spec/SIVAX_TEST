/**
 * Small server-side cache for handing payloads between two requests.
 *
 * Used to pass a DHIS2 analysis computed by the Python agent to the follow-up
 * `/api/dhis2/analysis` call made by the browser, without sending the dataset
 * through the client and trusting it back (PERF-01). The client only ever holds
 * an opaque key.
 *
 * Scope is the Node process. That is enough for the handoff, which happens
 * within seconds on the same server, and every consumer treats a miss as
 * "recompute" — so a cold replica degrades to the previous behaviour instead of
 * failing. Swap the Map for Redis when the deployment gains replicas.
 */

import { randomUUID } from "crypto";

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Cap on retained entries, so a burst cannot grow the map without bound. */
const MAX_ENTRIES = 500;

function evictExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  const now = Date.now();
  if (store.size >= MAX_ENTRIES) {
    evictExpired(now);
    // Still full of live entries: drop the oldest insertions (Map preserves
    // insertion order).
    while (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
  }
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
}

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Stores a value under a fresh opaque key and returns that key. */
export function cacheStash(value: unknown, ttlSeconds: number): string {
  const key = randomUUID();
  cacheSet(key, value, ttlSeconds);
  return key;
}

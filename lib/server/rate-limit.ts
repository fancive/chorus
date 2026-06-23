// In-memory fixed-window rate limiter. Single-instance assumption, consistent
// with lib/scheduler/runtime.ts — for multi-instance, swap for Upstash/Redis.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Bound memory: prune expired windows once the map grows past this.
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Fixed-window limiter. Returns ok=false once `limit` requests for `key` have
 * landed inside the current `windowMs`. Keys should embed the scope, e.g.
 * `turn:${token}` or `share:${ip}`.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  if (windows.size > MAX_TRACKED_KEYS) {
    for (const [k, w] of windows) {
      if (w.resetAt <= now) windows.delete(k);
    }
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: w.resetAt - now };
  }
  w.count += 1;
  return { ok: true, remaining: limit - w.count, retryAfterMs: 0 };
}

/** Test-only: clear all windows. */
export function __resetRateLimit() {
  windows.clear();
}

import { describe, expect, it, beforeEach } from "vitest";
import { rateLimit, __resetRateLimit } from "@/lib/server/rate-limit";

describe("rateLimit (fixed window)", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit then blocks with a retry hint", () => {
    const key = "k1";
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    const third = rateLimit(key, 3, 60_000);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 60_000).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000).ok).toBe(true);
  });

  it("a zero-length window lets the next call into a fresh window", () => {
    expect(rateLimit("c", 1, 0).ok).toBe(true);
    // resetAt = now + 0, so the next call sees an expired window and resets.
    expect(rateLimit("c", 1, 0).ok).toBe(true);
  });
});

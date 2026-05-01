"use client";

export type PaceSpeed = "slow" | "normal" | "fast" | "instant";

export const PACE_RATES: Record<PaceSpeed, number> = {
  slow: 15,
  normal: 26,
  fast: 48,
  instant: Number.POSITIVE_INFINITY,
};

export const PACE_LABELS: Record<PaceSpeed, string> = {
  slow: "慢",
  normal: "正常",
  fast: "快",
  instant: "瞬时",
};

const STORAGE_KEY = "chorus.paceSpeed";

export function getPaceSpeed(): PaceSpeed {
  if (typeof window === "undefined") return "normal";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "slow" || v === "normal" || v === "fast" || v === "instant") return v;
  return "normal";
}

export function setPaceSpeed(s: PaceSpeed) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, s);
}

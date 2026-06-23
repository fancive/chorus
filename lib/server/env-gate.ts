import { NextResponse } from "next/server";
import { validateProviderEnv } from "@/lib/providers";
import { validateDbEnv } from "@/lib/db";
import { logger } from "@/lib/server/logger";

/**
 * Returns a generic 503 response when required env is missing, else null.
 * The specific missing variables are logged server-side only — never returned
 * to the caller (they leak provider/db config to unauthenticated clients).
 */
export function envGate(route: string): NextResponse | null {
  const issues = [...validateProviderEnv(), ...validateDbEnv()];
  if (issues.length === 0) return null;
  logger.error("env_misconfigured", { route, issues });
  return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
}

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, validateDbEnv } from "@/lib/db";
import { validateProviderEnv } from "@/lib/providers";
import { logger, withRequestLog } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthReport {
  ok: boolean;
  db: "ok" | "env_missing" | "unreachable";
  provider: "ok" | "env_missing";
}

async function pingDb(): Promise<HealthReport["db"]> {
  try {
    const db = getDb();
    const row = await db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    return row?.ok === 1 ? "ok" : "unreachable";
  } catch (err) {
    // Log details server-side; don't echo internal error text to the world.
    logger.error("db_ping_failed", { err });
    return "unreachable";
  }
}

export const GET = withRequestLog("GET /api/health", async () => {
  const dbEnvIssues = validateDbEnv();
  const providerIssues = validateProviderEnv();

  if (dbEnvIssues.length || providerIssues.length) {
    const report: HealthReport = {
      ok: false,
      db: dbEnvIssues.length ? "env_missing" : "ok",
      provider: providerIssues.length ? "env_missing" : "ok",
    };
    return NextResponse.json(report, { status: 503 });
  }

  const db = await pingDb();
  const report: HealthReport = {
    ok: db === "ok",
    db,
    provider: "ok",
  };
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
});

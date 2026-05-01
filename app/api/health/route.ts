import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, validateDbEnv } from "@/lib/db";
import { validateProviderEnv } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthReport {
  ok: boolean;
  db: { ok: boolean; error?: string };
  provider: { ok: boolean; issues: string[] };
}

async function pingDb(): Promise<HealthReport["db"]> {
  try {
    const db = getDb();
    const row = await db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    if (row?.ok !== 1) return { ok: false, error: "unexpected_select_result" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const dbEnvIssues = validateDbEnv();
  const providerIssues = validateProviderEnv();

  if (dbEnvIssues.length || providerIssues.length) {
    return NextResponse.json(
      {
        ok: false,
        db: { ok: false, error: dbEnvIssues.join("; ") || undefined },
        provider: { ok: providerIssues.length === 0, issues: providerIssues },
      } satisfies HealthReport,
      { status: 503 },
    );
  }

  const dbReport = await pingDb();
  const report: HealthReport = {
    ok: dbReport.ok,
    db: dbReport,
    provider: { ok: true, issues: [] },
  };
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}

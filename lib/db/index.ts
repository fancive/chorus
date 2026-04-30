import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Resolve the libSQL connection target:
 * - Production / Turso: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).
 * - Local dev / CI: file:./chorus.db via CHORUS_DB_PATH (default ./chorus.db).
 */
function resolveTarget(): { url: string; authToken?: string } {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) {
    return {
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    };
  }
  const path = process.env.CHORUS_DB_PATH || "./chorus.db";
  const url = path.startsWith("file:") ? path : `file:${path}`;
  return { url };
}

export function getDb() {
  if (_db) return _db;
  const client = createClient(resolveTarget());
  _db = drizzle(client, { schema });
  return _db;
}

/** Returns a list of human-readable issues, empty if DB env is healthy. */
export function validateDbEnv(): string[] {
  const issues: string[] = [];
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) {
    if (!tursoUrl.startsWith("libsql://") && !tursoUrl.startsWith("file:")) {
      issues.push(
        `TURSO_DATABASE_URL must start with libsql:// or file: (got ${tursoUrl.slice(0, 12)}…)`,
      );
    }
    if (tursoUrl.startsWith("libsql://") && !process.env.TURSO_AUTH_TOKEN?.trim()) {
      issues.push("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL points at a remote db");
    }
  }
  return issues;
}

export { schema };

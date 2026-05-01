import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "chorus-health-"));
process.env.CHORUS_DB_PATH = join(tmp, "test.db");
delete process.env.TURSO_DATABASE_URL;

beforeAll(async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const client = createClient({ url: `file:${process.env.CHORUS_DB_PATH}` });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle/migrations" });
  client.close();
});

describe("GET /api/health", () => {
  it("503 when OPENAI_API_KEY missing", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { GET } = await import("@/app/api/health/route");
      const resp = await GET();
      expect(resp.status).toBe(503);
      const body = await resp.json();
      expect(body.ok).toBe(false);
      expect(body.provider.issues.length).toBeGreaterThan(0);
    } finally {
      if (prev) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("200 when env valid and DB reachable", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(true);
  });
});

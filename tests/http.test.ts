/**
 * HTTP-level integration tests. We invoke Next.js route handlers directly
 * (no real network) against a temp libSQL file and a mocked provider.
 *
 * The provider mock returns canned scheduler decisions and a tiny stream so
 * runTurn doesn't hang during /turn smoke checks.
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const tmp = mkdtempSync(join(tmpdir(), "chorus-http-"));
process.env.CHORUS_DB_PATH = join(tmp, "test.db");
process.env.OPENAI_API_KEY = "test-key";
delete process.env.TURSO_DATABASE_URL;

// Mock provider before importing routes so getProvider returns the fake.
vi.mock("@/lib/providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers")>(
    "@/lib/providers",
  );
  const fakeProvider = {
    name: "mock",
    model: "mock-1",
    capabilities: () => ({
      structuredOutput: "native" as const,
      streaming: true,
      maxContext: 128_000,
    }),
    generateJson: async () => ({
      next_speaker: "host",
      reason: "test",
      status_bar_hint: "",
      recap: "test recap",
      role_observations: [],
      user_highlights: [],
      quotes: [],
      follow_up_topics: [],
    }),
    streamText: async function* () {
      yield { text: "hello" };
    },
  };
  return {
    ...actual,
    getProvider: () => fakeProvider,
  };
});

beforeAll(async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const client = createClient({ url: `file:${process.env.CHORUS_DB_PATH}` });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle/migrations" });
  client.close();
});

const TOKEN_A = "tok_alice_" + Math.random().toString(36).slice(2);
const TOKEN_B = "tok_bob_" + Math.random().toString(36).slice(2);

function reqJson(url: string, init: { method: string; body?: unknown; token?: string }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers["x-chorus-token"] = init.token;
  return new NextRequest(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function createRoom(token: string): Promise<string> {
  const route = await import("@/app/api/room/route");
  const resp = await route.POST(
    reqJson("http://localhost/api/room", {
      method: "POST",
      body: {
        browserToken: token,
        nickname: "tester",
        roles: [{ kind: "template", templateId: "socrates" }],
      },
    }),
  );
  expect(resp.status).toBe(200);
  const body = await resp.json();
  return body.id as string;
}

describe("POST /api/room", () => {
  it("creates a session for token A", async () => {
    const id = await createRoom(TOKEN_A);
    expect(id).toMatch(/^sess_/);
  });
});

describe("GET /api/room/[id] ownership", () => {
  let sessionId: string;
  beforeAll(async () => {
    sessionId = await createRoom(TOKEN_A);
  });

  it("owner gets 200 with session payload", async () => {
    const route = await import("@/app/api/room/[id]/route");
    const resp = await route.GET(
      reqJson(`http://localhost/api/room/${sessionId}`, {
        method: "GET",
        token: TOKEN_A,
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.session.id).toBe(sessionId);
  });

  it("foreign token gets 404", async () => {
    const route = await import("@/app/api/room/[id]/route");
    const resp = await route.GET(
      reqJson(`http://localhost/api/room/${sessionId}`, {
        method: "GET",
        token: TOKEN_B,
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(resp.status).toBe(404);
  });

  it("missing token gets 404", async () => {
    const route = await import("@/app/api/room/[id]/route");
    const resp = await route.GET(
      reqJson(`http://localhost/api/room/${sessionId}`, {
        method: "GET",
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(resp.status).toBe(404);
  });
});

describe("PATCH/DELETE /api/room/[id]", () => {
  it("rename then list shows new title; delete then GET returns 404", async () => {
    const id = await createRoom(TOKEN_A);
    const route = await import("@/app/api/room/[id]/route");

    const renamed = await route.PATCH(
      reqJson(`http://localhost/api/room/${id}`, {
        method: "PATCH",
        token: TOKEN_A,
        body: { title: "renamed" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(renamed.status).toBe(200);

    const get1 = await route.GET(
      reqJson(`http://localhost/api/room/${id}`, { method: "GET", token: TOKEN_A }),
      { params: Promise.resolve({ id }) },
    );
    expect(get1.status).toBe(200);

    const del = await route.DELETE(
      reqJson(`http://localhost/api/room/${id}`, { method: "DELETE", token: TOKEN_A }),
      { params: Promise.resolve({ id }) },
    );
    expect(del.status).toBe(200);

    const get2 = await route.GET(
      reqJson(`http://localhost/api/room/${id}`, { method: "GET", token: TOKEN_A }),
      { params: Promise.resolve({ id }) },
    );
    expect(get2.status).toBe(404);
  });
});

describe("POST /api/room/[id]/turn guards", () => {
  it("foreign token gets 404", async () => {
    const id = await createRoom(TOKEN_A);
    const route = await import("@/app/api/room/[id]/turn/route");
    const resp = await route.POST(
      reqJson(`http://localhost/api/room/${id}/turn`, {
        method: "POST",
        token: TOKEN_B,
        body: {},
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(resp.status).toBe(404);
  });

  it("503 when env missing", async () => {
    const id = await createRoom(TOKEN_A);
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const route = await import("@/app/api/room/[id]/turn/route");
      const resp = await route.POST(
        reqJson(`http://localhost/api/room/${id}/turn`, {
          method: "POST",
          token: TOKEN_A,
          body: {},
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(resp.status).toBe(503);
    } finally {
      process.env.OPENAI_API_KEY = prev!;
    }
  });
});

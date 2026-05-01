import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "chorus-test-"));
process.env.CHORUS_DB_PATH = join(tmp, "test.db");
delete process.env.TURSO_DATABASE_URL;

// Apply migrations to the temp DB before importing repo (which lazily opens it).
const { createClient } = await import("@libsql/client");
const { drizzle } = await import("drizzle-orm/libsql");
const { migrate } = await import("drizzle-orm/libsql/migrator");
{
  const client = createClient({ url: `file:${process.env.CHORUS_DB_PATH}` });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle/migrations" });
  client.close();
}

const repo = await import("@/lib/db/repo");

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function makeSession() {
  const user = await repo.ensureUser({
    browserToken: "tok_" + Math.random().toString(36).slice(2),
    nickname: "tester",
  });
  const session = await repo.createSession({
    userId: user.id,
    mode: "dialogue",
    roleConfigs: [
      { kind: "template", templateId: "socrates" },
    ] as never,
    topic: null,
  });
  return { user, session };
}

describe("messages seq ordering", () => {
  let sessionId: string;
  beforeEach(async () => {
    const { session } = await makeSession();
    sessionId = session.id;
  });

  it("appendUserMessage assigns increasing seq within a session", async () => {
    await repo.appendUserMessage({ sessionId, content: "first" });
    await repo.appendUserMessage({ sessionId, content: "second" });
    await repo.appendUserMessage({ sessionId, content: "third" });
    const msgs = await repo.listMessages(sessionId);
    expect(msgs.map((m) => m.content)).toEqual(["first", "second", "third"]);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("UNIQUE(session_id, seq) constraint exists in the schema", async () => {
    // libsql local mode serializes one connection, so a true concurrent race
    // can't be reproduced here. We assert structurally that the unique index
    // exists and would catch a race in a multi-writer (Turso remote) deploy.
    const { createClient } = await import("@libsql/client");
    const url = `file:${process.env.CHORUS_DB_PATH}`;
    const client = createClient({ url });
    const rs = await client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='messages_session_seq_idx'",
    );
    client.close();
    expect(rs.rows.length).toBe(1);
    expect(String(rs.rows[0].sql)).toMatch(/UNIQUE/i);
  });

  it("createStreamingMessage and appendUserMessage interleave by seq", async () => {
    await repo.appendUserMessage({ sessionId, content: "u1" });
    const m = await repo.createStreamingMessage({
      sessionId,
      actor: "host",
      actorRoleIndex: null,
    });
    expect(m.seq).toBe(2);
    await repo.appendUserMessage({ sessionId, content: "u2" });
    const msgs = await repo.listMessages(sessionId);
    expect(msgs.map((m) => m.actor)).toEqual(["user", "host", "user"]);
  });
});

describe("getOwnedSession", () => {
  it("returns session when token matches owner; null otherwise", async () => {
    const { user, session } = await makeSession();
    expect((await repo.getOwnedSession(session.id, user.browserToken))?.id).toBe(session.id);
    expect(await repo.getOwnedSession(session.id, "wrong")).toBeNull();
    expect(await repo.getOwnedSession("nonexistent", user.browserToken)).toBeNull();
    expect(await repo.getOwnedSession(session.id, "")).toBeNull();
  });
});

describe("ensureUser upsert race-safety", () => {
  it("repeated calls return the same user without throwing", async () => {
    const token = "tok_repeat_" + Math.random().toString(36).slice(2);
    const a = await repo.ensureUser({ browserToken: token, nickname: "first" });
    const b = await repo.ensureUser({ browserToken: token, nickname: "first" });
    expect(b.id).toBe(a.id);
  });

  it("nickname patch updates the existing row", async () => {
    const token = "tok_nick_" + Math.random().toString(36).slice(2);
    const a = await repo.ensureUser({ browserToken: token, nickname: "old" });
    const b = await repo.ensureUser({ browserToken: token, nickname: "new" });
    expect(b.id).toBe(a.id);
    expect(b.nickname).toBe("new");
  });
});

import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "chorus-test-"));
process.env.CHORUS_DB_PATH = join(tmp, "test.db");

// Import after setting env so getDb opens the test file.
const Database = (await import("better-sqlite3")).default;
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
{
  const sqlite = new Database(process.env.CHORUS_DB_PATH);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle/migrations" });
  sqlite.close();
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
  const session = repo.createSession({
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

  it("appendUserMessage assigns increasing seq within a session", () => {
    repo.appendUserMessage({ sessionId, content: "first" });
    repo.appendUserMessage({ sessionId, content: "second" });
    repo.appendUserMessage({ sessionId, content: "third" });
    const msgs = repo.listMessages(sessionId);
    expect(msgs.map((m) => m.content)).toEqual(["first", "second", "third"]);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("createStreamingMessage and appendUserMessage interleave by seq", () => {
    repo.appendUserMessage({ sessionId, content: "u1" });
    const m = repo.createStreamingMessage({
      sessionId,
      actor: "host",
      actorRoleIndex: null,
    });
    expect(m.seq).toBe(2);
    repo.appendUserMessage({ sessionId, content: "u2" });
    const msgs = repo.listMessages(sessionId);
    expect(msgs.map((m) => m.actor)).toEqual(["user", "host", "user"]);
  });
});

describe("getOwnedSession", () => {
  it("returns session when token matches owner; null otherwise", async () => {
    const { user, session } = await makeSession();
    expect(repo.getOwnedSession(session.id, user.browserToken)?.id).toBe(session.id);
    expect(repo.getOwnedSession(session.id, "wrong")).toBeNull();
    expect(repo.getOwnedSession("nonexistent", user.browserToken)).toBeNull();
    expect(repo.getOwnedSession(session.id, "")).toBeNull();
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

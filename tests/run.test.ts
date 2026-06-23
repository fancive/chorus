/**
 * runTurn state-machine tests against a temp libSQL DB and a fake provider.
 * The fake scheduler ALWAYS answers "host"; the fake speaker streams "hello".
 * That lets us prove the single-role dialogue shortcut skipped the scheduler:
 * if the first scheduled speaker is role_0 (not host), the LLM was never asked.
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "chorus-run-"));
process.env.CHORUS_DB_PATH = join(tmp, "test.db");
process.env.OPENAI_API_KEY = "test-key";
delete process.env.TURSO_DATABASE_URL;

const generateJson = vi.fn(async () => ({
  data: { next_speaker: "host", reason: "r", status_bar_hint: "" },
  usage: { promptTokens: 1, completionTokens: 1 },
}));

vi.mock("@/lib/providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers")>("@/lib/providers");
  const fakeProvider = {
    name: "mock",
    model: "mock-1",
    capabilities: () => ({ structuredOutput: "native" as const, streaming: true, maxContext: 128_000 }),
    generateJson,
    streamText: async function* () {
      yield { text: "hello" };
      yield { text: "", usage: { promptTokens: 2, completionTokens: 2 } };
    },
  };
  return { ...actual, getProvider: () => fakeProvider };
});

beforeAll(async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const client = createClient({ url: `file:${process.env.CHORUS_DB_PATH}` });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle/migrations" });
  client.close();
});

type Ev = { type: string; [k: string]: unknown };

async function newSession() {
  const repo = await import("@/lib/db/repo");
  const user = await repo.ensureUser({
    browserToken: "tok_" + Math.random().toString(36).slice(2),
    nickname: "t",
  });
  const session = await repo.createSession({
    userId: user.id,
    mode: "dialogue",
    roleConfigs: [{ kind: "template", templateId: "socrates" }] as never,
    topic: null,
  });
  return session.id;
}

async function drive(sessionId: string): Promise<Ev[]> {
  const { runTurn } = await import("@/lib/scheduler/run");
  const events: Ev[] = [];
  await runTurn({ sessionId, emit: (e) => events.push(e as Ev) });
  return events;
}

describe("runTurn cold start", () => {
  it("opens with the host, persists completed messages, ends at await_user + streak cap", async () => {
    generateJson.mockClear();
    const id = await newSession();
    const events = await drive(id);

    const firstSchedule = events.find((e) => e.type === "schedule");
    expect(firstSchedule?.nextSpeaker).toBe("host");
    expect(events.some((e) => e.type === "message_start" && e.actor === "host")).toBe(true);
    expect(events.some((e) => e.type === "message_end" && e.status === "completed")).toBe(true);
    expect(events[events.length - 1].type).toBe("await_user");

    const repo = await import("@/lib/db/repo");
    const msgs = await repo.listMessages(id);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.actor === "host" && m.status === "completed")).toBe(true);
    const session = await repo.getSession(id);
    expect(session?.status).toBe("await_user");
    expect(session?.aiStreak).toBe(3); // MAX_AI_STREAK_SOLO
  });
});

describe("runTurn single-role dialogue shortcut", () => {
  it("routes a fresh user turn straight to role_0 without consulting the scheduler", async () => {
    const id = await newSession();
    const repo = await import("@/lib/db/repo");
    await repo.appendUserMessage({ sessionId: id, content: "你好，请回答我" });

    generateJson.mockClear();
    const events = await drive(id);

    const firstSchedule = events.find((e) => e.type === "schedule");
    // Scheduler mock would have said "host" — role_0 proves it was skipped.
    expect(firstSchedule?.nextSpeaker).toBe("role_0");
    const firstStart = events.find((e) => e.type === "message_start");
    expect(firstStart?.actor).toBe("role");
  });
});

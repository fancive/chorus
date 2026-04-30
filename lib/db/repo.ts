import { and, asc, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "./index";
import type { Mode } from "@/lib/scheduler/modes";
import type { RoleConfig } from "@/lib/prompts/role-builder";

export const newId = (prefix: string) => `${prefix}_${nanoid(12)}`;

type DbLike = Pick<ReturnType<typeof getDb>, "select">;

function nextSeq(tx: DbLike, sessionId: string): number {
  const row = tx
    .select({ max: sql<number>`COALESCE(MAX(${schema.messages.seq}), 0)` })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .get();
  return (row?.max ?? 0) + 1;
}

export async function ensureUser(input: {
  browserToken: string;
  nickname?: string;
}) {
  const db = getDb();
  const trimmedNick = input.nickname?.trim();
  const candidate: typeof schema.users.$inferInsert = {
    id: newId("usr"),
    nickname: trimmedNick || "无名氏",
    browserToken: input.browserToken,
  };
  // Atomic insert-or-do-nothing on the unique browser_token; then read back
  // and patch nickname if the caller supplied a different one.
  db.insert(schema.users)
    .values(candidate)
    .onConflictDoNothing({ target: schema.users.browserToken })
    .run();
  const existing = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserToken, input.browserToken))
    .get();
  if (!existing) throw new Error("user upsert failed");
  if (trimmedNick && trimmedNick !== existing.nickname) {
    db.update(schema.users)
      .set({ nickname: trimmedNick })
      .where(eq(schema.users.id, existing.id))
      .run();
    return { ...existing, nickname: trimmedNick };
  }
  return existing;
}

export interface CreateSessionInput {
  userId: string;
  mode: Mode;
  roleConfigs: RoleConfig[];
  topic?: string | null;
}

export function createSession(input: CreateSessionInput) {
  const db = getDb();
  const id = newId("sess");
  db.insert(schema.sessions)
    .values({
      id,
      userId: input.userId,
      mode: input.mode,
      roleConfigJson: JSON.stringify({
        roles: input.roleConfigs,
        topic: input.topic ?? null,
      }),
    })
    .run();
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!;
}

export function getSession(id: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
}

export function getUserByBrowserToken(browserToken: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserToken, browserToken))
    .get();
}

export function getOwnedSession(sessionId: string, browserToken: string) {
  if (!browserToken) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  const user = getUserByBrowserToken(browserToken);
  if (!user || user.id !== session.userId) return null;
  return session;
}

export function getSessionRolesAndTopic(sessionRow: typeof schema.sessions.$inferSelect): {
  roles: RoleConfig[];
  topic: string | null;
} {
  try {
    const parsed = JSON.parse(sessionRow.roleConfigJson);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.roles)) {
      throw new Error("invalid role config shape");
    }
    return {
      roles: parsed.roles as RoleConfig[],
      topic: typeof parsed.topic === "string" ? parsed.topic : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`session ${sessionRow.id} role config corrupt: ${message}`);
  }
}

export function updateSessionStatus(
  id: string,
  patch: Partial<{
    status: typeof schema.sessions.$inferSelect["status"];
    aiStreak: number;
    lastUserAt: Date | null;
    endedAt: Date | null;
  }>,
) {
  const db = getDb();
  db.update(schema.sessions).set(patch).where(eq(schema.sessions.id, id)).run();
}

export function listMessages(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.seq))
    .all();
}

export function appendUserMessage(input: { sessionId: string; content: string }) {
  const db = getDb();
  const id = newId("msg");
  db.transaction((tx) => {
    const seq = nextSeq(tx, input.sessionId);
    tx.insert(schema.messages)
      .values({
        id,
        sessionId: input.sessionId,
        actor: "user",
        content: input.content,
        status: "completed",
        revision: 1,
        seq,
      })
      .run();
  });
  return db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
}

export function createStreamingMessage(input: {
  sessionId: string;
  actor: "host" | "role";
  actorRoleIndex?: number | null;
}) {
  const db = getDb();
  const id = newId("msg");
  db.transaction((tx) => {
    const seq = nextSeq(tx, input.sessionId);
    tx.insert(schema.messages)
      .values({
        id,
        sessionId: input.sessionId,
        actor: input.actor,
        actorRoleIndex: input.actor === "role" ? input.actorRoleIndex ?? 0 : null,
        content: "",
        status: "streaming",
        revision: 0,
        seq,
      })
      .run();
  });
  return db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
}

export function appendDelta(messageId: string, delta: string) {
  const db = getDb();
  db.transaction((tx) => {
    const row = tx
      .select({ content: schema.messages.content, revision: schema.messages.revision })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .get();
    if (!row) throw new Error("message not found");
    tx.update(schema.messages)
      .set({ content: row.content + delta, revision: row.revision + 1 })
      .where(eq(schema.messages.id, messageId))
      .run();
  });
}

export function finalizeMessage(
  messageId: string,
  status: "completed" | "interrupted",
) {
  const db = getDb();
  db.update(schema.messages)
    .set({ status })
    .where(eq(schema.messages.id, messageId))
    .run();
}

export function findActiveStreamingMessages(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.sessionId, sessionId),
        eq(schema.messages.status, "streaming"),
      ),
    )
    .all();
}

export function recordGeneration(input: {
  sessionId: string;
  messageId: string | null;
  provider: string;
  model: string;
  purpose: "scheduler" | "speaker" | "summary";
  actorRoleIndex?: number | null;
}) {
  const db = getDb();
  const id = newId("gen");
  db.insert(schema.generations)
    .values({
      id,
      sessionId: input.sessionId,
      messageId: input.messageId,
      provider: input.provider,
      model: input.model,
      purpose: input.purpose,
      actorRoleIndex: input.actorRoleIndex ?? null,
      status: "pending",
    })
    .run();
  return id;
}

export function finalizeGeneration(
  id: string,
  status: "completed" | "aborted" | "failed",
  errorMessage?: string,
) {
  const db = getDb();
  db.update(schema.generations)
    .set({ status, endedAt: new Date(), errorMessage: errorMessage ?? null })
    .where(eq(schema.generations.id, id))
    .run();
}

export function saveSummary(sessionId: string, payload: unknown) {
  const db = getDb();
  const id = newId("sum");
  db.insert(schema.summaries)
    .values({
      id,
      sessionId,
      payloadJson: JSON.stringify(payload),
    })
    .run();
  return id;
}

export function getSummary(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.summaries)
    .where(eq(schema.summaries.sessionId, sessionId))
    .orderBy(desc(schema.summaries.createdAt))
    .limit(1)
    .get();
}

export function listSessionsForUser(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(desc(schema.sessions.createdAt))
    .all();
}

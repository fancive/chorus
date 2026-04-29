import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "./index";
import type { Mode } from "@/lib/scheduler/modes";
import type { RoleConfig } from "@/lib/prompts/role-builder";

export const newId = (prefix: string) => `${prefix}_${nanoid(12)}`;

export async function ensureUser(input: {
  browserToken: string;
  nickname?: string;
}) {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserToken, input.browserToken))
    .limit(1)
    .all();
  if (existing[0]) return existing[0];

  const user: typeof schema.users.$inferInsert = {
    id: newId("usr"),
    nickname: input.nickname?.trim() || "无名氏",
    browserToken: input.browserToken,
  };
  db.insert(schema.users).values(user).run();
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .get()!;
}

export interface CreateSessionInput {
  userId: string;
  mode: Mode;
  roleConfig: RoleConfig;
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
      roleConfigJson: JSON.stringify({ role: input.roleConfig, topic: input.topic ?? null }),
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

export function getSessionRoleAndTopic(sessionRow: typeof schema.sessions.$inferSelect): {
  role: RoleConfig;
  topic: string | null;
} {
  return JSON.parse(sessionRow.roleConfigJson);
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
    .orderBy(asc(schema.messages.createdAt))
    .all();
}

export function appendUserMessage(input: { sessionId: string; content: string }) {
  const db = getDb();
  const id = newId("msg");
  db.insert(schema.messages)
    .values({
      id,
      sessionId: input.sessionId,
      actor: "user",
      content: input.content,
      status: "completed",
      revision: 1,
    })
    .run();
  return db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
}

export function createStreamingMessage(input: {
  sessionId: string;
  actor: "host" | "role";
}) {
  const db = getDb();
  const id = newId("msg");
  db.insert(schema.messages)
    .values({
      id,
      sessionId: input.sessionId,
      actor: input.actor,
      content: "",
      status: "streaming",
      revision: 0,
    })
    .run();
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

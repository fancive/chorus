import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "./index";
import type { Mode } from "@/lib/scheduler/modes";
import type { RoleConfig } from "@/lib/prompts/role-builder";

export const newId = (prefix: string) => `${prefix}_${nanoid(12)}`;

type DbLike = Pick<ReturnType<typeof getDb>, "select">;

async function nextSeq(tx: DbLike, sessionId: string): Promise<number> {
  const row = await tx
    .select({ max: sql<number>`COALESCE(MAX(${schema.messages.seq}), 0)` })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .get();
  return (row?.max ?? 0) + 1;
}

const SEQ_CONFLICT_RE = /UNIQUE constraint failed: messages\.session_id, messages\.seq/i;
const SEQ_RETRY_LIMIT = 5;

function isRetryableInsertErr(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (SEQ_CONFLICT_RE.test(err.message)) return true;
  // libSQL surfaces SQLITE_BUSY when two writers race a transaction on the
  // same client; retry is the same recovery as a unique-conflict.
  const code = (err as { code?: unknown }).code;
  if (code === "SQLITE_BUSY") return true;
  if (/SQLITE_BUSY|database is locked|cannot commit transaction/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * Run a transaction body that depends on `nextSeq`. Racing writers can either
 * hit the unique index (both picked the same MAX(seq)+1) or SQLITE_BUSY (libSQL
 * single-connection contention). Both recover with a small retry.
 */
async function withSeqRetry<T>(body: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < SEQ_RETRY_LIMIT; attempt++) {
    try {
      return await body();
    } catch (err) {
      if (!isRetryableInsertErr(err)) throw err;
      lastErr = err;
      const backoffMs = 5 * (attempt + 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("nextSeq retries exhausted");
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
  await db
    .insert(schema.users)
    .values(candidate)
    .onConflictDoNothing({ target: schema.users.browserToken })
    .run();
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserToken, input.browserToken))
    .get();
  if (!existing) throw new Error("user upsert failed");
  if (trimmedNick && trimmedNick !== existing.nickname) {
    await db
      .update(schema.users)
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

export async function createSession(input: CreateSessionInput) {
  const db = getDb();
  const id = newId("sess");
  await db
    .insert(schema.sessions)
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
  const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
  if (!row) throw new Error("session insert lost");
  return row;
}

export async function getSession(id: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
}

export async function getUserByBrowserToken(browserToken: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserToken, browserToken))
    .get();
}

export async function getOwnedSession(sessionId: string, browserToken: string) {
  if (!browserToken) return null;
  const session = await getSession(sessionId);
  if (!session || session.deletedAt) return null;
  const user = await getUserByBrowserToken(browserToken);
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

export async function updateSessionStatus(
  id: string,
  patch: Partial<{
    status: typeof schema.sessions.$inferSelect["status"];
    aiStreak: number;
    lastUserAt: Date | null;
    endedAt: Date | null;
  }>,
) {
  const db = getDb();
  await db.update(schema.sessions).set(patch).where(eq(schema.sessions.id, id)).run();
}

export async function listMessages(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.seq))
    .all();
}

export async function findLastAiMessage(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.sessionId, sessionId),
        sql`${schema.messages.actor} != 'user'`,
      ),
    )
    .orderBy(desc(schema.messages.seq))
    .limit(1)
    .get();
}

export async function deleteMessage(messageId: string) {
  const db = getDb();
  await db.delete(schema.messages).where(eq(schema.messages.id, messageId)).run();
}

export async function appendUserMessage(input: { sessionId: string; content: string }) {
  const db = getDb();
  const id = newId("msg");
  await withSeqRetry(() =>
    db.transaction(async (tx) => {
      const seq = await nextSeq(tx, input.sessionId);
      await tx
        .insert(schema.messages)
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
    }),
  );
  const row = await db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
  if (!row) throw new Error("user message insert lost");
  return row;
}

export async function createStreamingMessage(input: {
  sessionId: string;
  actor: "host" | "role";
  actorRoleIndex?: number | null;
}) {
  const db = getDb();
  const id = newId("msg");
  await withSeqRetry(() =>
    db.transaction(async (tx) => {
      const seq = await nextSeq(tx, input.sessionId);
      await tx
        .insert(schema.messages)
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
    }),
  );
  const row = await db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
  if (!row) throw new Error("streaming message insert lost");
  return row;
}

export async function appendDelta(messageId: string, delta: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const row = await tx
      .select({ content: schema.messages.content, revision: schema.messages.revision })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .get();
    if (!row) throw new Error("message not found");
    await tx
      .update(schema.messages)
      .set({ content: row.content + delta, revision: row.revision + 1 })
      .where(eq(schema.messages.id, messageId))
      .run();
  });
}

export async function finalizeMessage(
  messageId: string,
  status: "completed" | "interrupted",
) {
  const db = getDb();
  await db
    .update(schema.messages)
    .set({ status })
    .where(eq(schema.messages.id, messageId))
    .run();
}

export async function findActiveStreamingMessages(sessionId: string) {
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

export async function recordGeneration(input: {
  sessionId: string;
  messageId: string | null;
  provider: string;
  model: string;
  purpose: "scheduler" | "speaker" | "summary";
  actorRoleIndex?: number | null;
}) {
  const db = getDb();
  const id = newId("gen");
  await db
    .insert(schema.generations)
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

export async function finalizeGeneration(
  id: string,
  status: "completed" | "aborted" | "failed",
  errorMessage?: string,
  usage?: { promptTokens?: number; completionTokens?: number },
) {
  const db = getDb();
  await db
    .update(schema.generations)
    .set({
      status,
      endedAt: new Date(),
      errorMessage: errorMessage ?? null,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
    })
    .where(eq(schema.generations.id, id))
    .run();
}

export async function getSessionTokenUsage(sessionId: string) {
  const db = getDb();
  const row = await db
    .select({
      prompt: sql<number>`COALESCE(SUM(${schema.generations.promptTokens}), 0)`,
      completion: sql<number>`COALESCE(SUM(${schema.generations.completionTokens}), 0)`,
      generations: sql<number>`COUNT(*)`,
    })
    .from(schema.generations)
    .where(eq(schema.generations.sessionId, sessionId))
    .get();
  return {
    promptTokens: Number(row?.prompt ?? 0),
    completionTokens: Number(row?.completion ?? 0),
    totalTokens: Number(row?.prompt ?? 0) + Number(row?.completion ?? 0),
    generations: Number(row?.generations ?? 0),
  };
}

export async function saveSummary(sessionId: string, payload: unknown) {
  const db = getDb();
  const id = newId("sum");
  await db
    .insert(schema.summaries)
    .values({
      id,
      sessionId,
      payloadJson: JSON.stringify(payload),
    })
    .run();
  return id;
}

export async function getSummary(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.summaries)
    .where(eq(schema.summaries.sessionId, sessionId))
    .orderBy(desc(schema.summaries.createdAt))
    .limit(1)
    .get();
}

export async function listSessionsForUser(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.deletedAt),
      ),
    )
    .orderBy(desc(schema.sessions.createdAt))
    .all();
}

export async function renameSession(sessionId: string, title: string) {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ title: title.trim() || null })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

export async function softDeleteSession(sessionId: string) {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ deletedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

export async function setShareToken(sessionId: string, token: string | null) {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ shareToken: token })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

export async function getSessionByShareToken(token: string) {
  if (!token) return null;
  const db = getDb();
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.shareToken, token))
    .get();
  if (!session || session.deletedAt) return null;
  return session;
}

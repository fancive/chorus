import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  browserToken: text("browser_token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    mode: text("mode", {
      enum: ["interview", "dialogue", "coach", "interviewee", "participant"],
    }).notNull(),
    roleConfigJson: text("role_config_json").notNull(),
    status: text("status", {
      enum: [
        "await_user",
        "scheduling",
        "speaking_host",
        "speaking_role",
        "interrupting",
        "summarizing",
        "ended",
      ],
    })
      .notNull()
      .default("await_user"),
    aiStreak: integer("ai_streak").notNull().default(0),
    lastUserAt: integer("last_user_at", { mode: "timestamp_ms" }),
    title: text("title"),
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    shareTokenIdx: uniqueIndex("sessions_share_token_idx").on(t.shareToken),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    actor: text("actor", { enum: ["user", "host", "role"] }).notNull(),
    actorRoleIndex: integer("actor_role_index"),
    content: text("content").notNull().default(""),
    status: text("status", {
      enum: ["streaming", "completed", "interrupted"],
    })
      .notNull()
      .default("completed"),
    revision: integer("revision").notNull().default(0),
    seq: integer("seq").notNull().default(0),
    metaJson: text("meta_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    sessionSeqIdx: uniqueIndex("messages_session_seq_idx").on(t.sessionId, t.seq),
    // findActiveStreamingMessages / reconcile filter by (session, status).
    sessionStatusIdx: index("messages_session_status_idx").on(
      t.sessionId,
      t.status,
    ),
  }),
);

export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    messageId: text("message_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose", {
      enum: ["scheduler", "speaker", "summary"],
    }).notNull(),
    actorRoleIndex: integer("actor_role_index"),
    status: text("status", {
      enum: ["pending", "streaming", "completed", "aborted", "failed"],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  // getSessionTokenUsage SUMs every row for a session on each /turn and /end.
  (t) => ({
    sessionIdx: index("generations_session_idx").on(t.sessionId),
  }),
);

export const summaries = sqliteTable(
  "summaries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  // getSummary looks up the latest row by session_id.
  (t) => ({
    sessionIdx: index("summaries_session_idx").on(t.sessionId),
  }),
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type Summary = typeof summaries.$inferSelect;

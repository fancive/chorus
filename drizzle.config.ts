import type { Config } from "drizzle-kit";

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const url = tursoUrl
  ? tursoUrl
  : (() => {
      const p = process.env.CHORUS_DB_PATH || "./chorus.db";
      return p.startsWith("file:") ? p : `file:${p}`;
    })();

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
} satisfies Config;

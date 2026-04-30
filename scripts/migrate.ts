import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const target = tursoUrl
    ? { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined }
    : (() => {
        const p = process.env.CHORUS_DB_PATH || "./chorus.db";
        return { url: p.startsWith("file:") ? p : `file:${p}` };
      })();

  const client = createClient(target);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  console.log("Migrations applied:", target.url);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

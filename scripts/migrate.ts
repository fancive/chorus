import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const path = process.env.CHORUS_DB_PATH || "./chorus.db";
const sqlite = new Database(path);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle/migrations" });
console.log("Migrations applied:", path);
sqlite.close();

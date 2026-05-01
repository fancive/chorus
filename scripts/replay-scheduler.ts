/**
 * Replay scheduler decisions for a saved session.
 *
 * Walks `messages` in seq order, slices history to each prefix, and asks the
 * scheduler "what would you decide here?" for every position where the next
 * speaker is host or role (i.e. AI). Prints a side-by-side comparison of the
 * actual next message vs what scheduler picks now.
 *
 * Usage: tsx scripts/replay-scheduler.ts <sessionId>
 */
import { getDb, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getSessionRolesAndTopic } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { buildHostIdentity } from "@/lib/prompts/host-identity";
import { normalizeMode } from "@/lib/scheduler/modes";
import {
  buildSchedulerOutput,
  buildSchedulerTask,
  type NextSpeakerTag,
} from "@/lib/prompts/host-scheduler";
import { projectForHostScheduler } from "@/lib/transcript/projection";
import { getProvider, validateProviderEnv } from "@/lib/providers";
import type { Message } from "@/lib/db/schema";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: tsx scripts/replay-scheduler.ts <sessionId>");
    process.exit(1);
  }
  const envIssues = validateProviderEnv();
  if (envIssues.length) {
    console.error("provider env not ready:", envIssues.join("; "));
    process.exit(1);
  }

  const db = getDb();
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!session) {
    console.error("session not found:", sessionId);
    process.exit(1);
  }

  const { roles: roleConfigs } = getSessionRolesAndTopic(session);
  const baseRoles = resolveRoles(roleConfigs);
  const hostIdentity = buildHostIdentity(normalizeMode(session.mode), baseRoles.length);

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.seq))
    .all();

  console.log(
    `# Replay session ${sessionId} (${baseRoles.map((r) => r.name).join(" / ")})`,
  );
  console.log(`# ${messages.length} messages`);
  console.log("");

  const provider = getProvider("host");
  const schema_out = buildSchedulerOutput(baseRoles.length);

  let aiStreak = 0;
  for (let i = 0; i < messages.length; i++) {
    const next = messages[i];
    if (next.actor === "user") {
      aiStreak = 0;
      continue;
    }

    const history = messages.slice(0, i);
    const last = history[history.length - 1];
    const lastRoleIndex =
      last?.actor === "role" ? last.actorRoleIndex ?? 0 : null;
    const userJustSpoke = last?.actor === "user";
    const isColdStart = history.length === 0;
    if (isColdStart) {
      console.log(`[${i}] cold-start (would always be host)`);
      console.log(`     actual: ${describe(next, baseRoles)}`);
      console.log("");
      aiStreak = 1;
      continue;
    }

    const lastSpeakerLabel = describe(last!, baseRoles);

    const projected = projectForHostScheduler({ history, hostIdentity, roles: baseRoles });
    projected.push({
      role: "user",
      content: buildSchedulerTask({
        mode: normalizeMode(session.mode),
        roles: baseRoles.map((r) => ({ name: r.name })),
        aiStreak,
        userJustSpoke,
        isColdStart,
        lastInterrupted: false,
        lastSpeakerLabel,
        lastRoleIndex,
        addressedRoleIndex: null,
      }),
    });

    try {
      const { data } = await provider.generateJson({
        schema: schema_out,
        schemaName: "scheduler_decision",
        purpose: "scheduler",
        messages: projected,
      });
      const replay = data.next_speaker as NextSpeakerTag;
      const actualTag: NextSpeakerTag =
        next.actor === "host"
          ? "host"
          : (`role_${next.actorRoleIndex ?? 0}` as NextSpeakerTag);
      const match = replay === actualTag ? "✓" : "✗";
      console.log(
        `[${i}] ${match}  actual=${actualTag}  replay=${replay}  reason="${data.reason}"`,
      );
    } catch (err) {
      console.log(`[${i}] !  error: ${err instanceof Error ? err.message : String(err)}`);
    }
    aiStreak += 1;
  }
}

function describe(m: Message, roles: { name: string }[]): string {
  if (m.actor === "user") return "user";
  if (m.actor === "host") return "host";
  const idx = m.actorRoleIndex ?? 0;
  return `role_${idx}(${roles[idx]?.name ?? "?"})`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextRequest, NextResponse } from "next/server";
import {
  getUserByBrowserToken,
  listSessionsForUser,
  getSessionRolesAndTopic,
  getSummary,
} from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { safeParseSummary } from "@/lib/prompts/host-summary";
import { extractBrowserToken } from "@/lib/server/auth";
import { withRequestLog } from "@/lib/server/logger";

export const runtime = "nodejs";

export const POST = withRequestLog("POST /api/me", async (req: NextRequest) => {
  // Read-only lookup keyed on the header token. Does NOT upsert — only routes
  // that create state (room creation) should mint user rows, otherwise probing
  // with arbitrary tokens silently grows the users table.
  const browserToken = extractBrowserToken(req);
  if (browserToken.length < 8) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getUserByBrowserToken(browserToken);
  if (!user) {
    // New device with no rooms yet — nothing to show, not an error.
    return NextResponse.json({ user: null, sessions: [] });
  }
  const sessions = await listSessionsForUser(user.id);
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const { roles: roleConfigs, topic } = getSessionRolesAndTopic(s);
      let names: string[] = [];
      try {
        names = resolveRoles(roleConfigs).map((r) => r.name);
      } catch {
        names = [];
      }
      const sum = await getSummary(s.id);
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        topic,
        roleNames: names,
        summary: sum ? safeParseSummary(sum.payloadJson) : null,
      };
    }),
  );
  return NextResponse.json({ user: { id: user.id, nickname: user.nickname }, sessions: enriched });
});

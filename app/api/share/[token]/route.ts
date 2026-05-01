import { NextRequest, NextResponse } from "next/server";
import {
  getSessionByShareToken,
  getSessionRolesAndTopic,
  getSummary,
  listMessages,
} from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { safeParseSummary } from "@/lib/prompts/host-summary";
import { withRequestLog } from "@/lib/server/logger";

export const runtime = "nodejs";

export const GET = withRequestLog(
  "GET /api/share/[token]",
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const { token } = await params;
    const session = await getSessionByShareToken(token);
    if (!session) {
      return NextResponse.json({ error: "share_not_found" }, { status: 404 });
    }
    const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
    const roles = resolveRoles(roleConfigs);
    const [messages, summary] = await Promise.all([
      listMessages(session.id),
      getSummary(session.id),
    ]);
    return NextResponse.json({
      session: {
        title: session.title,
        topic,
        roles: roles.map((r) => ({ name: r.name, initials: r.initials, color: r.color })),
        createdAt: session.createdAt,
        endedAt: session.endedAt,
      },
      summary: summary ? safeParseSummary(summary.payloadJson) : null,
      messages: messages
        .filter((m) => m.content.trim())
        .map((m) => ({
          actor: m.actor,
          actorRoleIndex: m.actorRoleIndex,
          content: m.content,
          status: m.status,
          seq: m.seq,
        })),
    });
  },
);

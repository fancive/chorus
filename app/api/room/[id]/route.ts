import { NextRequest, NextResponse } from "next/server";
import { getOwnedSession, getSessionRolesAndTopic, listMessages, getSummary } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { normalizeMode } from "@/lib/scheduler/modes";
import { extractBrowserToken } from "@/lib/server/auth";
import { safeParseSummary } from "@/lib/prompts/host-summary";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  const [messages, summary] = await Promise.all([listMessages(id), getSummary(id)]);
  return NextResponse.json({
    session: {
      id: session.id,
      mode: normalizeMode(session.mode),
      status: session.status,
      topic,
      roles: roles.map((r) => ({ name: r.name, initials: r.initials, color: r.color })),
      createdAt: session.createdAt,
      endedAt: session.endedAt,
    },
    messages: messages.map((m) => ({
      id: m.id,
      actor: m.actor,
      actorRoleIndex: m.actorRoleIndex,
      content: m.content,
      status: m.status,
      revision: m.revision,
      createdAt: m.createdAt,
    })),
    summary: summary ? safeParseSummary(summary.payloadJson) : null,
  });
}

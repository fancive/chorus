import { NextRequest, NextResponse } from "next/server";
import { getSession, getSessionRoleAndTopic, listMessages, getSummary } from "@/lib/db/repo";
import { resolveRole } from "@/lib/prompts/role-builder";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  const { role: roleConfig, topic } = getSessionRoleAndTopic(session);
  const role = resolveRole(roleConfig);
  const messages = listMessages(id);
  const summary = getSummary(id);
  return NextResponse.json({
    session: {
      id: session.id,
      mode: session.mode,
      status: session.status,
      topic,
      role: { name: role.name, initials: role.initials, color: role.color },
      createdAt: session.createdAt,
      endedAt: session.endedAt,
    },
    messages: messages.map((m) => ({
      id: m.id,
      actor: m.actor,
      content: m.content,
      status: m.status,
      revision: m.revision,
      createdAt: m.createdAt,
    })),
    summary: summary ? JSON.parse(summary.payloadJson) : null,
  });
}

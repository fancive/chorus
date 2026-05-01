import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOwnedSession,
  getSessionRolesAndTopic,
  listMessages,
  getSummary,
  renameSession,
  softDeleteSession,
} from "@/lib/db/repo";
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

const PatchBody = z.object({
  title: z.string().max(120).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (typeof parsed.data.title === "string") {
    await renameSession(id, parsed.data.title);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  await softDeleteSession(id);
  return NextResponse.json({ ok: true });
}

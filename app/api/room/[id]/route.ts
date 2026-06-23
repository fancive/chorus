import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOwnedSession,
  getSessionRolesAndTopic,
  getSessionTokenUsage,
  listMessages,
  getSummary,
  reconcileStaleSession,
  renameSession,
  softDeleteSession,
} from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { hasActiveGeneration } from "@/lib/scheduler/runtime";
import { normalizeMode } from "@/lib/scheduler/modes";
import { extractBrowserToken } from "@/lib/server/auth";
import { withRequestLog } from "@/lib/server/logger";
import { safeParseSummary } from "@/lib/prompts/host-summary";

export const runtime = "nodejs";

export const GET = withRequestLog("GET /api/room/[id]", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  // Self-heal an orphaned mid-stream turn before painting the room, but only
  // when no live generation is running in this process (otherwise we'd clobber
  // an actively streaming turn opened in another tab).
  if (
    session.status !== "ended" &&
    session.status !== "summarizing" &&
    !hasActiveGeneration(id)
  ) {
    await reconcileStaleSession(id);
  }
  const [messages, summary, usage] = await Promise.all([
    listMessages(id),
    getSummary(id),
    getSessionTokenUsage(id),
  ]);
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
    usage,
  });
});

const PatchBody = z.object({
  title: z.string().max(120).optional(),
});

export const PATCH = withRequestLog("PATCH /api/room/[id]", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
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
});

export const DELETE = withRequestLog("DELETE /api/room/[id]", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  await softDeleteSession(id);
  return NextResponse.json({ ok: true });
});

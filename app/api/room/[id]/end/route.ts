import { NextRequest, NextResponse } from "next/server";
import {
  finalizeGeneration,
  finalizeMessage,
  getOwnedSession,
  getSessionRolesAndTopic,
  listMessages,
  recordGeneration,
  saveSummary,
  updateSessionStatus,
  findActiveStreamingMessages,
  getSummary,
} from "@/lib/db/repo";
import { abortActiveGeneration } from "@/lib/scheduler/runtime";
import { buildHostIdentity } from "@/lib/prompts/host-identity";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { SUMMARY_TASK, SummaryOutput, safeParseSummary } from "@/lib/prompts/host-summary";
import { projectForSummary } from "@/lib/transcript/projection";
import { getProvider } from "@/lib/providers";
import { normalizeMode } from "@/lib/scheduler/modes";
import { extractBrowserToken } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  const existingSummary = getSummary(id);
  if (session.status === "ended" && existingSummary) {
    return NextResponse.json({
      ok: true,
      summary: safeParseSummary(existingSummary.payloadJson),
    });
  }

  // Stop any active stream and mark partial as interrupted.
  const aborted = abortActiveGeneration(id);
  if (aborted?.messageId) {
    finalizeMessage(aborted.messageId, "interrupted");
  }
  for (const m of findActiveStreamingMessages(id)) {
    finalizeMessage(m.id, "interrupted");
  }

  updateSessionStatus(id, { status: "summarizing" });
  const { roles: roleConfigs } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  const hostIdentity = buildHostIdentity(normalizeMode(session.mode), roles.length);
  const history = listMessages(id);

  const provider = getProvider("summary");
  const generationId = recordGeneration({
    sessionId: id,
    messageId: null,
    provider: provider.name,
    model: provider.model,
    purpose: "summary",
  });

  const messages = projectForSummary({ history, hostIdentity, roles });
  messages.push({ role: "user", content: SUMMARY_TASK });

  try {
    const result = await provider.generateJson({
      schema: SummaryOutput,
      schemaName: "session_summary",
      purpose: "summary",
      messages,
    });
    finalizeGeneration(generationId, "completed");
    saveSummary(id, result);
    updateSessionStatus(id, { status: "ended", endedAt: new Date() });
    return NextResponse.json({ ok: true, summary: result });
  } catch (err) {
    finalizeGeneration(
      generationId,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    updateSessionStatus(id, {
      status: session.status === "ended" ? "ended" : "await_user",
      endedAt: session.endedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "summary_failed",
      },
      { status: 500 },
    );
  }
}

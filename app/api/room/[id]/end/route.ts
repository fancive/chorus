import { NextRequest, NextResponse } from "next/server";
import {
  finalizeGeneration,
  finalizeMessage,
  getSession,
  getSessionRoleAndTopic,
  listMessages,
  recordGeneration,
  saveSummary,
  updateSessionStatus,
  findActiveStreamingMessages,
} from "@/lib/db/repo";
import { abortActiveGeneration } from "@/lib/scheduler/runtime";
import { buildHostIdentity } from "@/lib/prompts/host-identity";
import { resolveRole } from "@/lib/prompts/role-builder";
import { SUMMARY_TASK, SummaryOutput } from "@/lib/prompts/host-summary";
import { projectForSummary } from "@/lib/transcript/projection";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
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
  const { role: roleConfig } = getSessionRoleAndTopic(session);
  const role = resolveRole(roleConfig);
  const hostIdentity = buildHostIdentity(session.mode);
  const history = listMessages(id);

  const provider = getProvider("summary");
  const generationId = recordGeneration({
    sessionId: id,
    messageId: null,
    provider: provider.name,
    model: provider.model,
    purpose: "summary",
  });

  const messages = projectForSummary({ history, hostIdentity, role });
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
    updateSessionStatus(id, { status: "ended", endedAt: new Date() });
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "summary_failed",
      },
      { status: 500 },
    );
  }
}

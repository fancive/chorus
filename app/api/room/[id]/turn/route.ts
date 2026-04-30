import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  abortActiveGeneration,
  releaseTurnLock,
  stealTurnLock,
  tryAcquireTurnLock,
} from "@/lib/scheduler/runtime";
import { runTurn, resetAiStreak, type SseEvent } from "@/lib/scheduler/run";
import { appendUserMessage, finalizeMessage, getOwnedSession } from "@/lib/db/repo";
import { sseStream } from "@/lib/sse";
import { extractBrowserToken } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TurnBody = z.object({
  userMessage: z.string().max(4000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return new Response(JSON.stringify({ error: "session_not_found" }), {
      status: 404,
    });
  }
  if (session.status === "ended" || session.status === "summarizing") {
    return new Response(
      JSON.stringify({ error: "session_closed", status: session.status }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  const parsed = TurnBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid_body", issues: parsed.error.issues }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const body = parsed.data;
  const userText = body.userMessage?.trim();
  const lockToken = nanoid(8);

  // User-message arrival is a barge-in: it always preempts whatever turn is in
  // flight. Idle pings (no userMessage) instead respect the lock and back off
  // with 409 to avoid duplicate scheduling.
  if (userText) {
    const aborted = abortActiveGeneration(id);
    if (aborted?.messageId) finalizeMessage(aborted.messageId, "interrupted");
    stealTurnLock(id, lockToken);
    try {
      appendUserMessage({ sessionId: id, content: userText });
      resetAiStreak(id);
    } catch (err) {
      releaseTurnLock(id, lockToken);
      throw err;
    }
  } else if (!tryAcquireTurnLock(id, lockToken)) {
    return new Response(
      JSON.stringify({ error: "turn_in_progress" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  return sseStream<SseEvent>(async (emit, signal) => {
    signal.addEventListener("abort", () => {
      abortActiveGeneration(id);
    });
    try {
      await runTurn({ sessionId: id, emit, signal });
    } finally {
      releaseTurnLock(id, lockToken);
    }
  });
}

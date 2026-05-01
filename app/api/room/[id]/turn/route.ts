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
import {
  appendUserMessage,
  deleteMessage,
  finalizeMessage,
  findLastAiMessage,
  getOwnedSession,
  updateSessionStatus,
} from "@/lib/db/repo";
import { sseStream } from "@/lib/sse";
import { extractBrowserToken } from "@/lib/server/auth";
import { withRequestLog } from "@/lib/server/logger";
import { validateProviderEnv } from "@/lib/providers";
import { validateDbEnv } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TurnBody = z.object({
  userMessage: z.string().max(4000).optional(),
  regenerate: z.boolean().optional(),
  // User opted in to "let them keep talking" — bypass the AI-streak cap for
  // this turn by resetting the streak counter before runTurn runs.
  resumeStreak: z.boolean().optional(),
});

export const POST = withRequestLog("POST /api/room/[id]/turn", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const envIssues = [...validateProviderEnv(), ...validateDbEnv()];
  if (envIssues.length) {
    return new Response(
      JSON.stringify({ error: "env_misconfigured", issues: envIssues }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
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
  const wantRegenerate = body.regenerate === true && !userText;
  const wantResumeStreak =
    body.resumeStreak === true && !userText && !wantRegenerate;
  const lockToken = nanoid(8);

  // User-message arrival is a barge-in: it always preempts whatever turn is in
  // flight. Idle pings (no userMessage) instead respect the lock and back off
  // with 409 to avoid duplicate scheduling.
  if (userText) {
    const aborted = abortActiveGeneration(id);
    if (aborted?.messageId) await finalizeMessage(aborted.messageId, "interrupted");
    stealTurnLock(id, lockToken);
    try {
      await appendUserMessage({ sessionId: id, content: userText });
      await resetAiStreak(id);
    } catch (err) {
      releaseTurnLock(id, lockToken);
      throw err;
    }
  } else if (wantRegenerate) {
    // Regeneration: drop the most-recent AI message entirely (so the
    // scheduler doesn't re-read it as history) and rerun the turn from
    // before it. If the last message is the user's, fall through to idle.
    const aborted = abortActiveGeneration(id);
    if (aborted?.messageId) await finalizeMessage(aborted.messageId, "interrupted");
    stealTurnLock(id, lockToken);
    try {
      const last = await findLastAiMessage(id);
      if (last) {
        await deleteMessage(last.id);
        const newStreak = Math.max(0, session.aiStreak - 1);
        await updateSessionStatus(id, { aiStreak: newStreak });
      }
    } catch (err) {
      releaseTurnLock(id, lockToken);
      throw err;
    }
  } else if (wantResumeStreak) {
    if (!tryAcquireTurnLock(id, lockToken)) {
      return new Response(
        JSON.stringify({ error: "turn_in_progress" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    try {
      // Reset the streak so runTurn's hard-cap guard doesn't immediately
      // bounce us back to await_user.
      await updateSessionStatus(id, { aiStreak: 0 });
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
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { abortActiveGeneration } from "@/lib/scheduler/runtime";
import { runTurn, resetAiStreak, type SseEvent } from "@/lib/scheduler/run";
import { appendUserMessage, finalizeMessage, getSession } from "@/lib/db/repo";
import { sseStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TurnBody = z.object({
  userMessage: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: "session_not_found" }), {
      status: 404,
    });
  }
  const body = TurnBody.parse(await req.json().catch(() => ({})));

  // If a message is being streamed, abort it before persisting the new user input.
  if (body.userMessage && body.userMessage.trim()) {
    const aborted = abortActiveGeneration(id);
    if (aborted?.messageId) {
      finalizeMessage(aborted.messageId, "interrupted");
    }
    appendUserMessage({ sessionId: id, content: body.userMessage.trim() });
    resetAiStreak(id);
  }

  return sseStream<SseEvent>(async (emit, signal) => {
    signal.addEventListener("abort", () => {
      abortActiveGeneration(id);
    });
    await runTurn({ sessionId: id, emit });
  });
}

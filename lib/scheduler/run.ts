import { nanoid } from "nanoid";
import {
  appendDelta,
  createStreamingMessage,
  finalizeGeneration,
  finalizeMessage,
  getSession,
  getSessionRoleAndTopic,
  listMessages,
  recordGeneration,
  updateSessionStatus,
} from "@/lib/db/repo";
import { buildHostIdentity } from "@/lib/prompts/host-identity";
import {
  buildSchedulerTask,
  SchedulerOutput,
  type NextSpeaker,
} from "@/lib/prompts/host-scheduler";
import { buildHostSpeakerTask } from "@/lib/prompts/host-speaker";
import { resolveRole } from "@/lib/prompts/role-builder";
import { getProvider } from "@/lib/providers";
import {
  projectForHostScheduler,
  projectForHostSpeaker,
  projectForRoleSpeaker,
} from "@/lib/transcript/projection";
import {
  registerGeneration,
  clearGeneration,
  isAborted,
} from "./runtime";

const MAX_AI_STREAK = 3;

export type SseEvent =
  | { type: "schedule"; nextSpeaker: NextSpeaker; statusBarHint: string }
  | { type: "message_start"; messageId: string; actor: "host" | "role" }
  | { type: "delta"; messageId: string; revision: number; text: string }
  | { type: "message_end"; messageId: string; status: "completed" | "interrupted" }
  | { type: "await_user" }
  | { type: "error"; message: string };

export interface RunTurnArgs {
  sessionId: string;
  emit: (event: SseEvent) => void;
}

interface TurnDecision {
  next: NextSpeaker;
  reason: string;
  statusBarHint: string;
}

export async function runTurn({ sessionId, emit }: RunTurnArgs): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    emit({ type: "error", message: "session not found" });
    return;
  }
  if (session.status === "ended") {
    emit({ type: "error", message: "session ended" });
    return;
  }

  const { role: roleConfig, topic } = getSessionRoleAndTopic(session);
  const role = resolveRole(roleConfig);
  const hostIdentity = buildHostIdentity(session.mode);
  const history = listMessages(sessionId);
  const isColdStart = history.length === 0;
  const lastMessage = history[history.length - 1];
  const userJustSpoke = lastMessage?.actor === "user";
  const lastInterrupted = history.some(
    (m) => m.actor !== "user" && m.status === "interrupted",
  );

  // Hard rule: AI streak cap.
  if (session.aiStreak >= MAX_AI_STREAK && !userJustSpoke) {
    updateSessionStatus(sessionId, { status: "await_user" });
    emit({ type: "await_user" });
    return;
  }

  // Phase 1: scheduler decision (short, structured).
  let decision: TurnDecision;
  if (isColdStart) {
    decision = {
      next: "host",
      reason: "cold-start: host opens",
      statusBarHint: "",
    };
    emit({
      type: "schedule",
      nextSpeaker: "host",
      statusBarHint: "",
    });
  } else {
    updateSessionStatus(sessionId, { status: "scheduling" });
    const schedulerProvider = getProvider("host");
    const schedulerGenerationId = recordGeneration({
      sessionId,
      messageId: null,
      provider: schedulerProvider.name,
      model: schedulerProvider.model,
      purpose: "scheduler",
    });
    const messages = projectForHostScheduler({ history, hostIdentity, role });
    messages.push({
      role: "user",
      content: buildSchedulerTask({
        aiStreak: session.aiStreak,
        userJustSpoke,
        isColdStart,
        lastInterrupted,
        roleName: role.name,
      }),
    });
    try {
      const result = await schedulerProvider.generateJson({
        schema: SchedulerOutput,
        schemaName: "scheduler_decision",
        purpose: "scheduler",
        messages,
      });
      finalizeGeneration(schedulerGenerationId, "completed");
      decision = {
        next: result.next_speaker,
        reason: result.reason,
        statusBarHint: result.status_bar_hint || "",
      };
    } catch (err) {
      finalizeGeneration(
        schedulerGenerationId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      // Fallback: when scheduler fails, default to await_user.
      emit({ type: "error", message: "scheduler failed" });
      updateSessionStatus(sessionId, { status: "await_user" });
      emit({ type: "await_user" });
      return;
    }
    emit({
      type: "schedule",
      nextSpeaker: decision.next,
      statusBarHint: decision.statusBarHint,
    });
  }

  if (decision.next === "await_user") {
    updateSessionStatus(sessionId, { status: "await_user" });
    emit({ type: "await_user" });
    return;
  }

  // Phase 2: speaker generation (streaming).
  const actor: "host" | "role" = decision.next;
  updateSessionStatus(sessionId, {
    status: actor === "host" ? "speaking_host" : "speaking_role",
  });
  const message = createStreamingMessage({ sessionId, actor });
  const provider = getProvider(actor === "host" ? "host" : "role");
  const generationId = recordGeneration({
    sessionId,
    messageId: message.id,
    provider: provider.name,
    model: provider.model,
    purpose: "speaker",
  });
  const generationKey = nanoid(8);
  const abort = new AbortController();
  registerGeneration(sessionId, {
    id: generationKey,
    sessionId,
    abort,
    messageId: message.id,
  });

  let speakerMessages;
  if (actor === "host") {
    speakerMessages = projectForHostSpeaker({ history, hostIdentity, role });
    speakerMessages.push({
      role: "user",
      content: buildHostSpeakerTask({
        isColdStart,
        schedulerReason: decision.reason,
        roleName: role.name,
        topic,
      }),
    });
  } else {
    speakerMessages = projectForRoleSpeaker({ history, hostIdentity, role });
  }

  emit({ type: "message_start", messageId: message.id, actor });

  let aborted = false;
  let revision = 0;
  let any = false;
  try {
    for await (const delta of provider.streamText({
      messages: speakerMessages,
      purpose: "speaker",
      abortSignal: abort.signal,
    })) {
      if (isAborted(sessionId, generationKey)) {
        aborted = true;
        break;
      }
      if (!delta.text) continue;
      any = true;
      appendDelta(message.id, delta.text);
      revision += 1;
      emit({
        type: "delta",
        messageId: message.id,
        revision,
        text: delta.text,
      });
    }
    if (aborted || abort.signal.aborted) {
      finalizeMessage(message.id, "interrupted");
      finalizeGeneration(generationId, "aborted");
      emit({ type: "message_end", messageId: message.id, status: "interrupted" });
    } else {
      finalizeMessage(message.id, "completed");
      finalizeGeneration(generationId, "completed");
      emit({ type: "message_end", messageId: message.id, status: "completed" });
      const newStreak = session.aiStreak + 1;
      updateSessionStatus(sessionId, {
        aiStreak: newStreak,
        status: "await_user",
      });
    }
  } catch (err) {
    if (abort.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      finalizeMessage(message.id, "interrupted");
      finalizeGeneration(generationId, "aborted");
      emit({ type: "message_end", messageId: message.id, status: "interrupted" });
    } else {
      finalizeMessage(message.id, any ? "interrupted" : "interrupted");
      finalizeGeneration(
        generationId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    clearGeneration(sessionId, generationKey);
  }
}

export function resetAiStreak(sessionId: string) {
  updateSessionStatus(sessionId, { aiStreak: 0, lastUserAt: new Date() });
}

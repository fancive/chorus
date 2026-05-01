import { nanoid } from "nanoid";
import {
  appendDelta,
  createStreamingMessage,
  finalizeGeneration,
  finalizeMessage,
  getSession,
  getSessionRolesAndTopic,
  listMessages,
  recordGeneration,
  updateSessionStatus,
} from "@/lib/db/repo";
import { buildHostIdentity } from "@/lib/prompts/host-identity";
import {
  buildSchedulerOutput,
  buildSchedulerTask,
  type NextSpeakerTag,
} from "@/lib/prompts/host-scheduler";
import { buildHostSpeakerTask } from "@/lib/prompts/host-speaker";
import { resolveRoles, withDebateContext } from "@/lib/prompts/role-builder";
import { getProvider } from "@/lib/providers";
import { normalizeMode } from "@/lib/scheduler/modes";
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

const MAX_AI_STREAK_SOLO = 3;
const MAX_AI_STREAK_DEBATE = 4;

export type SseEvent =
  | { type: "schedule"; nextSpeaker: NextSpeakerTag; statusBarHint: string }
  | { type: "message_start"; messageId: string; actor: "host" | "role"; actorRoleIndex: number | null }
  | { type: "delta"; messageId: string; revision: number; text: string }
  | { type: "message_end"; messageId: string; status: "completed" | "interrupted" }
  | { type: "await_user" }
  | { type: "error"; message: string };

export interface RunTurnArgs {
  sessionId: string;
  emit: (event: SseEvent) => void;
  signal?: AbortSignal;
}

interface TurnDecision {
  next: NextSpeakerTag;
  reason: string;
  statusBarHint: string;
}

function parseRoleIndex(tag: NextSpeakerTag): number | null {
  if (tag === "host" || tag === "await_user") return null;
  const m = /^role_(\d+)$/.exec(tag);
  return m ? Number(m[1]) : null;
}

function isAbortLike(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (err instanceof Error && (err.name === "AbortError" || err.message === "interrupted by user")),
  );
}

export async function runTurn({ sessionId, emit, signal }: RunTurnArgs): Promise<void> {
  while (!signal?.aborted) {
    const session = await getSession(sessionId);
    if (!session) {
      emit({ type: "error", message: "session not found" });
      return;
    }
    if (session.status === "ended" || session.status === "summarizing") {
      emit({ type: "error", message: `session ${session.status}` });
      return;
    }

    const mode = normalizeMode(session.mode);
    const { roles: roleConfigs, topic, debateFlavor } = getSessionRolesAndTopic(session);
    const baseRoles = resolveRoles(roleConfigs);
    const rolesWithCtx =
      baseRoles.length > 1
        ? baseRoles.map((_, i) => withDebateContext(baseRoles, i))
        : baseRoles;
    const hostIdentity = buildHostIdentity(mode, baseRoles.length);
    const history = await listMessages(sessionId);
    const isColdStart = history.length === 0;
    const lastMessage = history[history.length - 1];
    const userJustSpoke = lastMessage?.actor === "user";
    const lastAssistant = [...history].reverse().find((m) => m.actor !== "user");
    const lastInterrupted = lastAssistant?.status === "interrupted";
    const lastRoleIndex =
      lastMessage?.actor === "role" ? lastMessage.actorRoleIndex ?? 0 : null;
    const lastSpeakerLabel = (() => {
      if (!lastMessage) return "（无）";
      if (lastMessage.actor === "user") return "用户";
      if (lastMessage.actor === "host") return "主持人";
      const idx = lastMessage.actorRoleIndex ?? 0;
      return `role_${idx} (${baseRoles[idx]?.name ?? "?"})`;
    })();
    const addressedRoleIndex: number | null = (() => {
      if (lastMessage?.actor !== "host") return null;
      const tail = lastMessage.content.slice(Math.max(0, lastMessage.content.length - 60));
      let bestPos = -1;
      let bestIdx: number | null = null;
      for (let i = 0; i < baseRoles.length; i++) {
        const pos = tail.lastIndexOf(baseRoles[i].name);
        if (pos > bestPos) {
          bestPos = pos;
          bestIdx = i;
        }
      }
      return bestIdx;
    })();

    const isDebate = baseRoles.length > 1;
    const maxStreak = isDebate ? MAX_AI_STREAK_DEBATE : MAX_AI_STREAK_SOLO;
    if (session.aiStreak >= maxStreak && !userJustSpoke) {
      await updateSessionStatus(sessionId, { status: "await_user" });
      emit({ type: "await_user" });
      return;
    }

    let decision: TurnDecision;
    if (isColdStart) {
      decision = { next: "host", reason: "cold-start: host opens", statusBarHint: "" };
      emit({ type: "schedule", nextSpeaker: "host", statusBarHint: "" });
    } else {
      await updateSessionStatus(sessionId, { status: "scheduling" });
      const schedulerProvider = getProvider("host");
      const schedulerGenerationId = await recordGeneration({
        sessionId,
        messageId: null,
        provider: schedulerProvider.name,
        model: schedulerProvider.model,
        purpose: "scheduler",
      });
      const schedulerKey = nanoid(8);
      const schedulerAbort = new AbortController();
      const abortScheduler = () => schedulerAbort.abort(new Error("interrupted by user"));
      signal?.addEventListener("abort", abortScheduler, { once: true });
      if (signal?.aborted) abortScheduler();
      registerGeneration(sessionId, {
        id: schedulerKey,
        sessionId,
        abort: schedulerAbort,
        messageId: null,
      });
      const messages = projectForHostScheduler({
        history,
        hostIdentity,
        roles: baseRoles,
      });
      messages.push({
        role: "user",
        content: buildSchedulerTask({
          mode,
          roles: baseRoles.map((r) => ({
            name: r.name,
            talkativeness: r.talkativeness,
          })),
          debateFlavor,
          aiStreak: session.aiStreak,
          userJustSpoke,
          isColdStart,
          lastInterrupted: Boolean(lastInterrupted),
          lastSpeakerLabel,
          lastRoleIndex,
          addressedRoleIndex,
        }),
      });
      try {
        const schema = buildSchedulerOutput(baseRoles.length);
        const { data: result, usage } = await schedulerProvider.generateJson({
          schema,
          schemaName: "scheduler_decision",
          purpose: "scheduler",
          messages,
          abortSignal: schedulerAbort.signal,
        });
        await finalizeGeneration(schedulerGenerationId, "completed", undefined, usage);
        decision = {
          next: result.next_speaker as NextSpeakerTag,
          reason: result.reason,
          statusBarHint: result.status_bar_hint || "",
        };
      } catch (err) {
        await finalizeGeneration(
          schedulerGenerationId,
          isAbortLike(err, schedulerAbort.signal) ? "aborted" : "failed",
          isAbortLike(err, schedulerAbort.signal)
            ? undefined
            : err instanceof Error
              ? err.message
              : String(err),
        );
        if (isAbortLike(err, schedulerAbort.signal)) {
          await updateSessionStatus(sessionId, { status: "await_user" });
          return;
        }
        emit({ type: "error", message: "scheduler failed" });
        await updateSessionStatus(sessionId, { status: "await_user" });
        emit({ type: "await_user" });
        return;
      } finally {
        signal?.removeEventListener("abort", abortScheduler);
        clearGeneration(sessionId, schedulerKey);
      }

      if (
        addressedRoleIndex !== null &&
        decision.next !== `role_${addressedRoleIndex}` &&
        session.aiStreak < maxStreak
      ) {
        decision = {
          ...decision,
          next: `role_${addressedRoleIndex}` as NextSpeakerTag,
          reason: `host addressed role_${addressedRoleIndex}, forcing route`,
        };
      }

      const proposedIdx = parseRoleIndex(decision.next);
      if (
        isDebate &&
        proposedIdx !== null &&
        lastRoleIndex !== null &&
        proposedIdx === lastRoleIndex
      ) {
        const otherIdx = baseRoles.findIndex((_, i) => i !== lastRoleIndex);
        decision =
          otherIdx >= 0
            ? { ...decision, next: `role_${otherIdx}` as NextSpeakerTag }
            : { ...decision, next: "await_user" };
      }

      emit({
        type: "schedule",
        nextSpeaker: decision.next,
        statusBarHint: decision.statusBarHint,
      });
    }

    if (signal?.aborted) return;
    if (decision.next === "await_user") {
      await updateSessionStatus(sessionId, { status: "await_user" });
      emit({ type: "await_user" });
      return;
    }

    const isHost = decision.next === "host";
    const roleIndex = isHost ? null : parseRoleIndex(decision.next);
    if (!isHost && (roleIndex === null || roleIndex >= baseRoles.length)) {
      emit({ type: "error", message: `invalid role index in scheduler decision: ${decision.next}` });
      await updateSessionStatus(sessionId, { status: "await_user" });
      emit({ type: "await_user" });
      return;
    }
    const actor: "host" | "role" = isHost ? "host" : "role";

    await updateSessionStatus(sessionId, {
      status: actor === "host" ? "speaking_host" : "speaking_role",
    });
    const message = await createStreamingMessage({
      sessionId,
      actor,
      actorRoleIndex: roleIndex,
    });
    const provider = getProvider(actor === "host" ? "host" : "role");
    const generationId = await recordGeneration({
      sessionId,
      messageId: message.id,
      provider: provider.name,
      model: provider.model,
      purpose: "speaker",
      actorRoleIndex: roleIndex,
    });
    const generationKey = nanoid(8);
    const abort = new AbortController();
    const abortSpeaker = () => abort.abort(new Error("interrupted by user"));
    signal?.addEventListener("abort", abortSpeaker, { once: true });
    if (signal?.aborted) abortSpeaker();
    registerGeneration(sessionId, {
      id: generationKey,
      sessionId,
      abort,
      messageId: message.id,
    });

    const speakerMessages =
      actor === "host"
        ? projectForHostSpeaker({ history, hostIdentity, roles: baseRoles })
        : projectForRoleSpeaker(
            { history, hostIdentity, roles: rolesWithCtx },
            roleIndex!,
          );
    if (actor === "host") {
      speakerMessages.push({
        role: "user",
        content: buildHostSpeakerTask({
          mode,
          isColdStart,
          schedulerReason: decision.reason,
          roleNames: baseRoles.map((r) => r.name),
          topic,
        }),
      });
    }

    emit({
      type: "message_start",
      messageId: message.id,
      actor,
      actorRoleIndex: roleIndex,
    });

    let aborted = false;
    let completed = false;
    let revision = 0;
    let buffer = "";
    let speakerUsage: { promptTokens?: number; completionTokens?: number } | undefined;
    const FLUSH_CHARS = 128;
    const FLUSH_MS = 200;
    let lastFlushAt = Date.now();
    const flush = async () => {
      if (!buffer) return;
      const chunk = buffer;
      buffer = "";
      await appendDelta(message.id, chunk);
      revision += 1;
      emit({ type: "delta", messageId: message.id, revision, text: chunk });
      lastFlushAt = Date.now();
    };
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
        if (delta.usage) speakerUsage = delta.usage;
        if (!delta.text) continue;
        buffer += delta.text;
        if (buffer.length >= FLUSH_CHARS || Date.now() - lastFlushAt >= FLUSH_MS) {
          await flush();
        }
      }
      await flush();
      if (aborted || abort.signal.aborted) {
        await flush();
        await finalizeMessage(message.id, "interrupted");
        await finalizeGeneration(generationId, "aborted", undefined, speakerUsage);
        emit({ type: "message_end", messageId: message.id, status: "interrupted" });
        // Status was set to speaking_*; restore so the next caller sees a sane state.
        const fresh = await getSession(sessionId);
        if (fresh && fresh.status !== "ended" && fresh.status !== "summarizing") {
          await updateSessionStatus(sessionId, { status: "await_user" });
        }
        return;
      }
      await finalizeMessage(message.id, "completed");
      await finalizeGeneration(generationId, "completed", undefined, speakerUsage);
      emit({ type: "message_end", messageId: message.id, status: "completed" });
      const newStreak = session.aiStreak + 1;
      await updateSessionStatus(sessionId, { aiStreak: newStreak, status: "await_user" });
      completed = true;
    } catch (err) {
      // flush() may itself throw (e.g. the originating error was a Turso write
      // failure that will reproduce). Swallow that inner failure so the rest of
      // the catch can still finalize the message and clear the speaking_*
      // session status — otherwise the message row stays in "streaming" and
      // only gets cleaned up by the next /end call.
      try {
        await flush();
      } catch {
        /* drop tail; we are already in the failure path */
      }
      if (isAbortLike(err, abort.signal)) {
        await finalizeMessage(message.id, "interrupted");
        await finalizeGeneration(generationId, "aborted", undefined, speakerUsage);
        emit({ type: "message_end", messageId: message.id, status: "interrupted" });
        const fresh = await getSession(sessionId);
        if (fresh && fresh.status !== "ended" && fresh.status !== "summarizing") {
          await updateSessionStatus(sessionId, { status: "await_user" });
        }
        return;
      }
      await finalizeMessage(message.id, "interrupted");
      await finalizeGeneration(
        generationId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      await updateSessionStatus(sessionId, { status: "await_user" });
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    } finally {
      signal?.removeEventListener("abort", abortSpeaker);
      clearGeneration(sessionId, generationKey);
    }

    if (!completed) return;
  }
}

export async function resetAiStreak(sessionId: string) {
  await updateSessionStatus(sessionId, { aiStreak: 0, lastUserAt: new Date() });
}

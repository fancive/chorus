"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRoomStore } from "@/lib/client/store";
import { Avatar } from "./Avatar";
import { postTurn } from "@/lib/client/sse";
import { getOrCreateBrowserToken } from "@/lib/client/identity";
import {
  PACE_LABELS,
  PACE_RATES,
  getPaceSpeed,
  setPaceSpeed,
  type PaceSpeed,
} from "@/lib/client/pace";

export function RoomView({
  sessionId,
}: {
  sessionId: string;
}) {
  const meta = useRoomStore((s) => s.meta);
  const messages = useRoomStore((s) => s.messages);
  const statusBarHint = useRoomStore((s) => s.statusBarHint);
  const awaiting = useRoomStore((s) => s.awaiting);
  const ended = useRoomStore((s) => s.ended);
  const applyEvent = useRoomStore((s) => s.applyEvent);
  const appendUserMessage = useRoomStore((s) => s.appendUserMessage);
  const removeMessage = useRoomStore((s) => s.removeMessage);
  const markStreamingInterrupted = useRoomStore((s) => s.markStreamingInterrupted);
  const setEnded = useRoomStore((s) => s.setEnded);
  const tickPace = useRoomStore((s) => s.tickPace);

  const [input, setInput] = useState("");
  const [endingSummary, setEndingSummary] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<PaceSpeed>("normal");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Read persisted speed once on mount.
  useEffect(() => {
    setSpeedState(getPaceSpeed());
  }, []);

  // Drive paced rendering: tick every 50ms and let the store advance
  // each message's `displayedLen` toward `content.length`.
  useEffect(() => {
    const interval = 50;
    const handle = setInterval(() => {
      tickPace(interval, PACE_RATES[speed]);
    }, interval);
    return () => clearInterval(handle);
  }, [speed, tickPace]);

  // Auto-trigger initial turn (cold start) once.
  const coldStartRef = useRef(false);
  useEffect(() => {
    if (!meta || coldStartRef.current) return;
    if (messages.length === 0 && awaiting === "user") {
      coldStartRef.current = true;
      void runTurn();
    }
  }, [meta, messages.length, awaiting]);

  // Idle host: if user hasn't typed for IDLE_MS while it's their turn, ping the
  // server with an empty turn so the host can break the silence. Dedupe by the
  // last assistant message id so a follow-up "await_user" decision doesn't
  // restart the timer indefinitely on the same anchor.
  const IDLE_MS = 12_000;
  const idledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (ended || awaiting !== "user" || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.actor === "user") {
      idledForRef.current = null;
      return;
    }
    if (idledForRef.current === last.id) return;
    const anchorId = last.id;
    const t = setTimeout(() => {
      idledForRef.current = anchorId;
      void runTurn();
    }, IDLE_MS);
    return () => clearTimeout(t);
  }, [ended, awaiting, messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function runTurn(
    opts: {
      userMessage?: string;
      optimisticId?: string;
      regenerate?: boolean;
      resumeStreak?: boolean;
    } = {},
  ): Promise<{ ok: boolean; preFailed: boolean }> {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    let preFailed = false;
    let streamFailed = false;
    await postTurn(
      sessionId,
      {
        userMessage: opts.userMessage,
        regenerate: opts.regenerate,
        resumeStreak: opts.resumeStreak,
      },
      {
        onEvent: (e) => applyEvent(e as Parameters<typeof applyEvent>[0]),
        onError: (err, phase) => {
          const message = err instanceof Error ? err.message : String(err);
          setErrorText(message);
          applyEvent({ type: "error", message });
          if (phase === "pre") {
            preFailed = true;
            if (opts.optimisticId) removeMessage(opts.optimisticId);
          } else {
            streamFailed = true;
          }
        },
      },
      ctrl.signal,
    );
    return { ok: !preFailed && !streamFailed, preFailed };
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || ended) return;
    setInput("");
    setErrorText(null);
    markStreamingInterrupted();
    const tempId = `local_${Date.now()}`;
    appendUserMessage(tempId, text);
    const result = await runTurn({ userMessage: text, optimisticId: tempId });
    if (result.preFailed) setInput(text);
  }

  async function handleEnd() {
    if (ended || endingSummary) return;
    setEndingSummary(true);
    setErrorText(null);
    abortRef.current?.abort();
    markStreamingInterrupted();
    const resp = await fetch(`/api/room/${sessionId}/end`, {
      method: "POST",
      headers: { "x-chorus-token": getOrCreateBrowserToken() },
    });
    if (resp.ok) {
      setEnded();
      window.location.href = `/room/${sessionId}/summary`;
    } else {
      const body = await resp.json().catch(() => null);
      setErrorText(body?.error || "总结生成失败，请稍后重试");
      setEndingSummary(false);
    }
  }

  if (!meta) return null;

  const roleLabel = (idx: number | null) => {
    if (idx === null || idx === undefined) return meta.roles[0]?.name ?? "参会人";
    return meta.roles[idx]?.name ?? `参会人${idx}`;
  };
  const roleAvatar = (idx: number | null) => {
    const r = meta.roles[idx ?? 0];
    return r ? { initials: r.initials, color: r.color } : { initials: "?", color: "#94a3b8" };
  };
  const currentlyStreaming = messages.find((m) => m.status === "streaming");
  const speakerLine = currentlyStreaming
    ? `${currentlyStreaming.actor === "host" ? "主持人" : roleLabel(currentlyStreaming.actorRoleIndex)} 正在说...`
    : awaiting === "ai"
      ? "正在调度..."
      : ended
        ? "对话已结束"
        : "等你说";

  return (
    <div className="flex h-screen flex-col bg-ink-50 dark:bg-ink-950">
      <header className="surface flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="shrink-0 text-sm text-ink-500 transition hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
        >
          ← 返回
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {meta.roles.map((r) => r.name).join(" / ")}
          </div>
          {meta.topic && (
            <div className="truncate text-xs text-ink-500 dark:text-ink-400">
              {meta.topic}
            </div>
          )}
        </div>
        <select
          value={speed}
          onChange={(e) => {
            const v = e.target.value as PaceSpeed;
            setSpeedState(v);
            setPaceSpeed(v);
          }}
          aria-label="发言节奏"
          title="发言节奏"
          className="shrink-0 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 transition hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
        >
          {(Object.keys(PACE_LABELS) as PaceSpeed[]).map((s) => (
            <option key={s} value={s}>
              {PACE_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          onClick={handleEnd}
          disabled={ended || endingSummary}
          className="shrink-0 rounded-full bg-ink-900 px-3 py-1.5 text-xs font-medium text-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-md disabled:translate-y-0 disabled:bg-ink-300 dark:bg-accent-600 dark:hover:bg-accent-500 dark:disabled:bg-ink-700"
        >
          {endingSummary ? "总结中..." : "结束并总结"}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 && (
            <p className="text-center text-sm text-ink-400">主持人即将开场...</p>
          )}
          {messages.map((m, mi) => {
            const isLast = mi === messages.length - 1;
            const canRegenerate =
              m.actor !== "user" && isLast && m.status !== "streaming" && !ended && awaiting === "user";
            const visibleText = m.content.slice(0, m.displayedLen);
            const streamingPlaceholder = (
              <span className="inline-flex gap-1 text-ink-400">
                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                <span
                  className="size-1.5 animate-pulse rounded-full bg-current"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="size-1.5 animate-pulse rounded-full bg-current"
                  style={{ animationDelay: "300ms" }}
                />
              </span>
            );

            // Host messages are meta-narration, not a peer in the conversation:
            // render as a horizontal-rule + centered light text, no avatar / bubble.
            if (m.actor === "host") {
              return (
                <div key={m.id} className="my-4 animate-fade-in">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-400">
                      主持人
                    </span>
                    <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                  </div>
                  <div className="mx-auto mt-2 max-w-xl whitespace-pre-wrap text-center text-[14px] leading-relaxed text-ink-500 dark:text-ink-300">
                    {visibleText || streamingPlaceholder}
                  </div>
                  {m.status === "interrupted" && (
                    <div className="mt-1 text-center text-[11px] text-amber-600 dark:text-amber-400">
                      被你打断了
                    </div>
                  )}
                  {canRegenerate && (
                    <div className="mt-1 text-center">
                      <button
                        type="button"
                        onClick={() => void runTurn({ regenerate: true })}
                        className="text-[11px] text-ink-400 transition hover:text-ink-700 dark:hover:text-ink-200"
                      >
                        ↻ 重新生成
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            const isUser = m.actor === "user";
            const avatar = isUser
              ? { initials: "你", color: "#0f172a" }
              : roleAvatar(m.actorRoleIndex);
            const tag = isUser ? "你" : roleLabel(m.actorRoleIndex);
            return (
              <div
                key={m.id}
                className={`flex animate-fade-in gap-3 ${isUser ? "flex-row-reverse" : ""}`}
              >
                <Avatar initials={avatar.initials} color={avatar.color} />
                <div className={`min-w-0 max-w-[80%] ${isUser ? "items-end text-right" : ""}`}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                    {tag}
                  </div>
                  <div
                    className={`mt-1 whitespace-pre-wrap rounded-bubble px-4 py-2.5 text-[15px] leading-relaxed shadow-card ${
                      isUser
                        ? "bg-ink-900 text-white dark:bg-accent-600"
                        : "bg-white text-ink-900 dark:bg-ink-900 dark:text-ink-50"
                    }`}
                  >
                    {visibleText || streamingPlaceholder}
                  </div>
                  {m.status === "interrupted" && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      被你打断了
                    </div>
                  )}
                  {canRegenerate && (
                    <button
                      type="button"
                      onClick={() => void runTurn({ regenerate: true })}
                      className="mt-1 text-[11px] text-ink-400 transition hover:text-ink-700 dark:hover:text-ink-200"
                    >
                      ↻ 重新生成
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="surface border-t">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-xs text-ink-500 sm:px-6">
          <span>{speakerLine}</span>
          {statusBarHint && (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              {statusBarHint}
            </span>
          )}
          {errorText && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-500/15 dark:text-red-400">
              {errorText}
            </span>
          )}
          {!ended &&
            awaiting === "user" &&
            messages.length > 0 &&
            messages[messages.length - 1].actor !== "user" && (
              <button
                type="button"
                onClick={() => void runTurn({ resumeStreak: true })}
                className="ml-auto rounded-full bg-ink-100 px-3 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                让他们接着聊
              </button>
            )}
        </div>
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 px-4 pb-4 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <div className="flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 4000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={ended}
              rows={1}
              className="block max-h-40 w-full resize-y rounded-2xl border border-ink-200 bg-white px-4 py-2.5 text-[15px] leading-6 shadow-card placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 dark:border-ink-700 dark:bg-ink-900"
              placeholder={ended ? "对话已结束" : "随时打断也行（Enter 发送，Shift+Enter 换行）"}
            />
            {input.length > 3500 && (
              <div className="mt-1 text-right text-xs text-ink-400">
                {input.length} / 4000
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!input.trim() || ended}
            className="h-11 shrink-0 rounded-full bg-ink-900 px-5 text-sm font-medium text-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-md disabled:translate-y-0 disabled:bg-ink-300 disabled:shadow-none dark:bg-accent-600 dark:hover:bg-accent-500 dark:disabled:bg-ink-700"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}

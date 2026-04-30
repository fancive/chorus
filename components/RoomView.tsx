"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRoomStore } from "@/lib/client/store";
import { Avatar } from "./Avatar";
import { postTurn } from "@/lib/client/sse";
import { getOrCreateBrowserToken } from "@/lib/client/identity";

const HOST_AVATAR = { initials: "主", color: "#64748b" };

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

  const [input, setInput] = useState("");
  const [endingSummary, setEndingSummary] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    userMessage?: string,
    optimisticId?: string,
  ): Promise<{ ok: boolean; preFailed: boolean }> {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    let preFailed = false;
    let streamFailed = false;
    await postTurn(
      sessionId,
      { userMessage },
      {
        onEvent: (e) => applyEvent(e as Parameters<typeof applyEvent>[0]),
        onError: (err, phase) => {
          const message = err instanceof Error ? err.message : String(err);
          setErrorText(message);
          applyEvent({ type: "error", message });
          if (phase === "pre") {
            preFailed = true;
            if (optimisticId) removeMessage(optimisticId);
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
    const result = await runTurn(text, tempId);
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-sm text-slate-500 hover:text-slate-900">
          ← 返回
        </Link>
        <div className="min-w-0 flex-1 text-sm text-slate-600">
          <div className="truncate font-medium text-slate-900">
            {meta.roles.map((r) => r.name).join(" / ")}
          </div>
          {meta.topic && (
            <div className="truncate text-xs text-slate-500">{meta.topic}</div>
          )}
        </div>
        <button
          onClick={handleEnd}
          disabled={ended || endingSummary}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {endingSummary ? "总结中..." : "结束并总结"}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400">主持人即将开场...</p>
          )}
          {messages.map((m) => {
            const avatar =
              m.actor === "user"
                ? { initials: "你", color: "#0f172a" }
                : m.actor === "host"
                  ? HOST_AVATAR
                  : roleAvatar(m.actorRoleIndex);
            const tag =
              m.actor === "user"
                ? "你"
                : m.actor === "host"
                  ? "主持人"
                  : roleLabel(m.actorRoleIndex);
            return (
              <div key={m.id} className="flex gap-3">
                <Avatar initials={avatar.initials} color={avatar.color} />
                <div className="flex-1">
                  <div className="text-xs text-slate-500">{tag}</div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-900">
                    {m.content || (m.status === "streaming" ? "..." : "")}
                  </div>
                  {m.status === "interrupted" && (
                    <div className="mt-1 text-xs text-amber-600">被你打断了</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-2 text-xs text-slate-500">
          <span>{speakerLine}</span>
          {statusBarHint && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {statusBarHint}
            </span>
          )}
          {errorText && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
              {errorText}
            </span>
          )}
        </div>
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 px-6 pb-4"
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
              className="block max-h-40 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder={ended ? "对话已结束" : "随时打断也行（Enter 发送，Shift+Enter 换行）"}
            />
            {input.length > 3500 && (
              <div className="mt-1 text-right text-xs text-slate-400">
                {input.length} / 4000
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!input.trim() || ended}
            className="h-10 shrink-0 rounded-md bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}

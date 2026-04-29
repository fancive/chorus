"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRoomStore } from "@/lib/client/store";
import { Avatar } from "./Avatar";
import { postTurn } from "@/lib/client/sse";

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
  const setEnded = useRoomStore((s) => s.setEnded);

  const [input, setInput] = useState("");
  const [endingSummary, setEndingSummary] = useState(false);
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function runTurn(userMessage?: string) {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    await postTurn(
      sessionId,
      { userMessage },
      {
        onEvent: (e) => applyEvent(e as Parameters<typeof applyEvent>[0]),
        onError: () => {},
      },
      ctrl.signal,
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || ended) return;
    setInput("");
    const tempId = `local_${Date.now()}`;
    appendUserMessage(tempId, text);
    await runTurn(text);
  }

  async function handleEnd() {
    if (ended || endingSummary) return;
    setEndingSummary(true);
    abortRef.current?.abort();
    const resp = await fetch(`/api/room/${sessionId}/end`, { method: "POST" });
    if (resp.ok) {
      setEnded();
      window.location.href = `/room/${sessionId}/summary`;
    } else {
      setEndingSummary(false);
    }
  }

  if (!meta) return null;

  const currentlyStreaming = messages.find((m) => m.status === "streaming");
  const speakerLine = currentlyStreaming
    ? `${currentlyStreaming.actor === "host" ? "主持人" : meta.role.name} 正在说...`
    : awaiting === "ai"
      ? "正在调度..."
      : ended
        ? "对话已结束"
        : "等你说";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
            ← 返回
          </Link>
          <div className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">{meta.role.name}</span>
            <span className="mx-2 text-slate-300">·</span>
            <span>
              {meta.mode === "interview"
                ? "访谈"
                : meta.mode === "dialogue"
                  ? "对谈"
                  : "教练"}
            </span>
            {meta.topic && (
              <>
                <span className="mx-2 text-slate-300">·</span>
                <span className="text-slate-500">{meta.topic}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={handleEnd}
          disabled={ended || endingSummary}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:bg-slate-300"
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
                  : { initials: meta.role.initials, color: meta.role.color };
            const tag =
              m.actor === "user" ? "你" : m.actor === "host" ? "主持人" : meta.role.name;
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
        </div>
        <form
          className="mx-auto flex max-w-3xl gap-2 px-6 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={ended}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder={ended ? "对话已结束" : "随时打断也行"}
          />
          <button
            type="submit"
            disabled={!input.trim() || ended}
            className="rounded-md bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}

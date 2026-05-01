"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrCreateBrowserToken, getNickname } from "@/lib/client/identity";

interface SessionEntry {
  id: string;
  topic: string | null;
  roleNames: string[];
  status: string;
  createdAt: string;
  endedAt: string | null;
  summary: { recap: string } | null;
}

export default function HomePage() {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [nickname, setNickname] = useState<string>("");

  useEffect(() => {
    setNickname(getNickname());
    const browserToken = getOrCreateBrowserToken();
    void fetch("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserToken, nickname: getNickname() || undefined }),
    })
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions))
      .catch(() => setSessions([]));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16 sm:py-20">
      <header className="animate-fade-in">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Chorus
        </h1>
        <p className="mt-2 text-base text-ink-500 dark:text-ink-400">
          一个由主持人控场的多角色 AI 对话空间。
        </p>
      </header>

      <div className="mt-10 animate-fade-in">
        <Link
          href="/new"
          className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-6 py-3 text-sm font-medium text-white shadow-card transition hover:-translate-y-0.5 hover:bg-ink-800 hover:shadow-card-md dark:bg-accent-600 dark:hover:bg-accent-500"
        >
          创建房间
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <section className="mt-16 animate-fade-in">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-ink-400">
            我的对话
          </h2>
          {sessions !== null && sessions.length > 0 && (
            <span className="text-xs text-ink-400">{sessions.length} 场</span>
          )}
        </div>

        <div className="mt-4">
          {sessions === null ? (
            <ul className="space-y-2">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-20 skeleton" aria-hidden="true" />
              ))}
            </ul>
          ) : sessions.length === 0 ? (
            <div className="surface rounded-xl border px-6 py-10 text-center">
              <p className="text-sm text-ink-500 dark:text-ink-400">
                还没有会话。建一个房间开始吧。
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={s.endedAt ? `/room/${s.id}/summary` : `/room/${s.id}`}
                    className="surface block rounded-xl border px-5 py-4 shadow-card transition hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-card-md dark:hover:border-ink-600"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {s.roleNames.length ? s.roleNames.join(" / ") : "对话"}
                        </div>
                        {s.topic && (
                          <div className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">
                            {s.topic}
                          </div>
                        )}
                        {s.summary?.recap && (
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-500 dark:text-ink-400">
                            {s.summary.recap}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            s.endedAt
                              ? "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                              : "bg-accent-100 text-accent-700 dark:bg-accent-500/15 dark:text-accent-400"
                          }`}
                        >
                          {s.endedAt ? "已结束" : "进行中"}
                        </span>
                        <span className="text-[10px] text-ink-400">
                          {formatDate(s.createdAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {nickname && (
        <p className="mt-16 text-xs text-ink-400">你好，{nickname}</p>
      )}
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("zh-CN", {
    month: sameYear ? "short" : "numeric",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

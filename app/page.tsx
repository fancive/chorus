"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getOrCreateBrowserToken, getNickname } from "@/lib/client/identity";

interface SessionEntry {
  id: string;
  title: string | null;
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
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    setNickname(getNickname());
    void fetch("/api/me", {
      method: "POST",
      headers: { "x-chorus-token": getOrCreateBrowserToken() },
    })
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]));
  }, []);

  const filtered = useMemo(() => {
    if (!sessions) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [
        s.title ?? "",
        s.topic ?? "",
        s.roleNames.join(" "),
        s.summary?.recap ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [sessions, filter]);

  async function rename(id: string, title: string) {
    const trimmed = title.trim().slice(0, 120);
    setSessions((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, title: trimmed || null } : s)) : prev,
    );
    setRenaming(null);
    await fetch(`/api/room/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-chorus-token": getOrCreateBrowserToken(),
      },
      body: JSON.stringify({ title: trimmed }),
    });
  }

  async function softDelete(id: string) {
    if (!confirm("删除这场对话？删除后不可恢复。")) return;
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    await fetch(`/api/room/${id}`, {
      method: "DELETE",
      headers: { "x-chorus-token": getOrCreateBrowserToken() },
    });
  }

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
            <span className="text-xs text-ink-400">
              {filtered?.length ?? 0} / {sessions.length}
            </span>
          )}
        </div>

        {sessions !== null && sessions.length > 3 && (
          <div className="mt-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索话题、参会人、标题…"
              className="surface w-full rounded-full border px-4 py-2 text-sm placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
            />
          </div>
        )}

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
          ) : filtered && filtered.length === 0 ? (
            <div className="surface rounded-xl border px-6 py-8 text-center text-sm text-ink-500 dark:text-ink-400">
              没有匹配的对话
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered?.map((s) => {
                const headline = s.title?.trim() || (s.roleNames.length ? s.roleNames.join(" / ") : "对话");
                const isRenaming = renaming === s.id;
                return (
                  <li key={s.id} className="group relative">
                    <Link
                      href={s.endedAt ? `/room/${s.id}/summary` : `/room/${s.id}`}
                      className="surface block rounded-xl border px-5 py-4 shadow-card transition hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-card-md dark:hover:border-ink-600"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <input
                              autoFocus
                              defaultValue={s.title ?? ""}
                              placeholder={s.roleNames.join(" / ")}
                              onClick={(e) => e.preventDefault()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void rename(s.id, (e.target as HTMLInputElement).value);
                                } else if (e.key === "Escape") {
                                  setRenaming(null);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== (s.title ?? "")) {
                                  void rename(s.id, e.target.value);
                                } else {
                                  setRenaming(null);
                                }
                              }}
                              className="w-full rounded-md border border-accent-500 bg-white px-2 py-1 text-sm font-medium focus:outline-none dark:bg-ink-900"
                            />
                          ) : (
                            <div className="truncate text-sm font-medium">{headline}</div>
                          )}
                          {!isRenaming && s.topic && (
                            <div className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">
                              {s.topic}
                            </div>
                          )}
                          {!isRenaming && s.summary?.recap && (
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
                    {!isRenaming && (
                      <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setRenaming(s.id);
                          }}
                          aria-label="重命名"
                          title="重命名"
                          className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] text-ink-500 shadow-card backdrop-blur transition hover:bg-white hover:text-ink-900 dark:bg-ink-800/90 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-100"
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            void softDelete(s.id);
                          }}
                          aria-label="删除"
                          title="删除"
                          className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] text-red-600 shadow-card backdrop-blur transition hover:bg-white dark:bg-ink-800/90 dark:hover:bg-ink-800"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
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

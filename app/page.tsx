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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Chorus / 对话场</h1>
      <p className="mt-3 text-slate-600">一个由主持人控场的多角色 AI 对话空间。</p>
      <div className="mt-10">
        <Link
          href="/new"
          className="inline-flex items-center rounded-md bg-slate-900 px-5 py-3 text-white hover:bg-slate-800"
        >
          创建房间
        </Link>
      </div>

      <section className="mt-16">
        <h2 className="text-sm font-medium text-slate-500">我的</h2>
        <div className="mt-3">
          {sessions === null ? (
            <p className="text-sm text-slate-400">加载中...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-400">还没有会话。建一个房间开始吧。</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={s.endedAt ? `/room/${s.id}/summary` : `/room/${s.id}`}
                    className="block rounded-md border border-slate-200 bg-white px-4 py-3 hover:border-slate-400"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-900">
                        {s.roleNames.length ? s.roleNames.join(" / ") : "对话"}
                        {s.topic && (
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            · {s.topic}
                          </span>
                        )}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {new Date(s.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <span className={`text-xs ${s.endedAt ? "text-slate-400" : "text-emerald-600"}`}>
                        {s.endedAt ? "已结束" : "进行中"}
                      </span>
                    </div>
                    {s.summary?.recap && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {s.summary.recap}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {nickname && (
        <p className="mt-12 text-xs text-slate-400">你好，{nickname}</p>
      )}
    </main>
  );
}

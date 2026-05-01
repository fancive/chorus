"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";

interface ShareData {
  session: {
    title: string | null;
    topic: string | null;
    roles: { name: string; initials: string; color: string }[];
    createdAt: string;
    endedAt: string | null;
  };
  summary: {
    recap: string;
    role_observations: string[];
    user_highlights: string[];
    quotes: { speaker: string; text: string }[];
    follow_up_topics: string[];
  } | null;
  messages: {
    actor: "user" | "host" | "role";
    actorRoleIndex: number | null;
    content: string;
    status: "completed" | "interrupted" | "streaming";
    seq: number;
  }[];
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/share/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("分享链接无效或已被关闭");
        return r.json();
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token]);

  if (error) return <main className="p-8 text-red-600 dark:text-red-400">{error}</main>;
  if (!data) return <main className="p-8 text-ink-400">加载中...</main>;

  const { session, summary, messages } = data;
  const roles = session.roles;
  const headline = session.title?.trim() || roles.map((r) => r.name).join(" / ");

  const roleLabel = (idx: number | null) => {
    if (idx === null || idx === undefined) return roles[0]?.name ?? "参会人";
    return roles[idx]?.name ?? `参会人${idx}`;
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="text-xs uppercase tracking-[0.2em] text-ink-400">分享视图（只读）</div>
      <h1 className="mt-2 text-2xl font-semibold">{headline}</h1>
      {session.topic && (
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{session.topic}</p>
      )}
      <p className="mt-2 text-xs text-ink-400">
        {new Date(session.createdAt).toLocaleString("zh-CN")}
      </p>

      {summary && (
        <section className="mt-8 rounded-xl surface border p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-ink-400">
            会后总结
          </h2>
          <p className="mt-2 whitespace-pre-wrap leading-7">{summary.recap}</p>
        </section>
      )}

      <section className="mt-8 space-y-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-ink-400">
          完整对话
        </h2>
        {messages.map((m, i) => {
          // Host messages are meta-narration, not a peer in the conversation —
          // mirror RoomView's centered horizontal-rule treatment.
          if (m.actor === "host") {
            return (
              <div key={i} className="my-4">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-400">
                    主持人
                  </span>
                  <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                </div>
                <div className="mx-auto mt-2 max-w-xl whitespace-pre-wrap text-center text-[14px] leading-relaxed text-ink-500 dark:text-ink-300">
                  {m.content}
                </div>
                {m.status === "interrupted" && (
                  <div className="mt-1 text-center text-[11px] text-amber-600 dark:text-amber-400">
                    被打断
                  </div>
                )}
              </div>
            );
          }

          const isUser = m.actor === "user";
          const tag = isUser ? "用户" : roleLabel(m.actorRoleIndex);
          const avatar = isUser
            ? { initials: "你", color: "#0f172a" }
            : roles[m.actorRoleIndex ?? 0] ?? { initials: "?", color: "#94a3b8" };
          return (
            <div
              key={i}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
            >
              <Avatar initials={avatar.initials} color={avatar.color} />
              <div className={`min-w-0 max-w-[80%] ${isUser ? "text-right" : ""}`}>
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
                  {m.content}
                </div>
                {m.status === "interrupted" && (
                  <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    被打断
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div className="mt-12 border-t border-ink-200 pt-6 text-xs text-ink-400 dark:border-ink-700">
        <Link href="/" className="hover:text-ink-700 dark:hover:text-ink-200">
          ← 回到 Chorus
        </Link>
      </div>
    </main>
  );
}

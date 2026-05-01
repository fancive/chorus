"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getOrCreateBrowserToken } from "@/lib/client/identity";

interface SummaryPayload {
  recap: string;
  role_observations: string[];
  user_highlights: string[];
  stances?: { speaker: string; position: string; keyArgument: string }[];
  quotes: { speaker: string; text: string }[];
  follow_up_topics: string[];
}

interface RoomData {
  session: {
    id: string;
    mode: string;
    topic: string | null;
    roles: { name: string; initials: string; color: string }[];
  };
  summary: SummaryPayload | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    generations: number;
  };
}

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/room/${id}`, {
      headers: { "x-chorus-token": getOrCreateBrowserToken() },
    })
      .then((r) => {
        if (!r.ok) throw new Error("房间不存在或已不可访问");
        return r.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) return <main className="p-8 text-red-700 dark:text-red-400">{error}</main>;
  if (!data) return <main className="p-8 text-ink-400">加载中...</main>;
  const summary = data.summary;
  const roles = data.session.roles;
  const isDebate = roles.length > 1;
  const roleName = roles[0]?.name ?? "参会人";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/"
        className="text-sm text-ink-500 transition hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
      >
        ← 返回首页
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">会后总结</h1>

      {!summary ? (
        <p className="mt-8 text-ink-500 dark:text-ink-400">这次会话没有生成总结。</p>
      ) : (
        <div className="mt-8 space-y-8">
          <Section title="本轮聊了什么">
            <p className="whitespace-pre-wrap leading-7">{summary.recap}</p>
          </Section>
          {isDebate && summary.stances && summary.stances.length > 1 && (
            <Section title="立场对照">
              <ul className="space-y-3">
                {summary.stances.map((s, i) => (
                  <li
                    key={i}
                    className="surface rounded-lg border px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{s.speaker}</span>
                      <span className="text-xs text-ink-500 dark:text-ink-400">
                        {s.position}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-ink-700 dark:text-ink-200">
                      {s.keyArgument}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {summary.role_observations.length > 0 && (
            <Section title={isDebate ? "参会人的关键观点" : `${roleName}的关键观点`}>
              <ul className="list-disc space-y-1 pl-5">
                {summary.role_observations.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          )}
          {summary.user_highlights.length > 0 && (
            <Section title="你的关键表达">
              <ul className="list-disc space-y-1 pl-5">
                {summary.user_highlights.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          )}
          {summary.quotes.length > 0 && (
            <Section title="金句 / Take-away">
              <div className="space-y-2">
                {summary.quotes.map((q, i) => (
                  <QuoteCard key={i} text={q.text} speaker={q.speaker} />
                ))}
              </div>
            </Section>
          )}
          {summary.follow_up_topics.length > 0 && (
            <Section title="可以继续聊的话题">
              <ul className="space-y-2">
                {summary.follow_up_topics.map((s, i) => (
                  <li
                    key={i}
                    className="surface-muted flex items-center justify-between rounded-md px-3 py-2"
                  >
                    <span>{s}</span>
                    <Link
                      href={`/new?topic=${encodeURIComponent(s)}`}
                      className="text-xs text-ink-500 transition hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
                    >
                      用这个开新房间
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
      {data.usage && data.usage.totalTokens > 0 && (
        <div className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
          <span>
            {data.usage.generations} 次模型调用
          </span>
          <span>
            prompt {data.usage.promptTokens.toLocaleString()} tok
          </span>
          <span>
            completion {data.usage.completionTokens.toLocaleString()} tok
          </span>
          <span className="font-medium text-ink-500">
            合计 {data.usage.totalTokens.toLocaleString()} tok
          </span>
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-2 border-t border-ink-200 pt-6 dark:border-ink-700">
        <ExportButton id={id} format="md" label="Markdown" onError={setError} />
        <ExportButton id={id} format="json" label="JSON" onError={setError} />
        <ExportButton id={id} format="html" label="HTML" onError={setError} />
        <ShareButton id={id} onError={setError} />
        <Link
          href="/new"
          className="ml-auto rounded-full bg-ink-900 px-5 py-2 text-sm font-medium text-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-md dark:bg-accent-600 dark:hover:bg-accent-500"
        >
          再来一场
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-ink-400">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ShareButton({
  id,
  onError,
}: {
  id: string;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          onError(null);
          try {
            const r = await fetch(`/api/room/${id}/share`, {
              method: "POST",
              headers: { "x-chorus-token": getOrCreateBrowserToken() },
            });
            if (!r.ok) {
              if (r.status === 409) {
                onError("对话需要先结束才能生成分享链接");
              } else {
                onError("生成分享链接失败");
              }
              return;
            }
            const { token } = (await r.json()) as { token: string };
            const url = `${window.location.origin}/share/${token}`;
            try {
              await navigator.clipboard.writeText(url);
              setToast(`已复制：${url}`);
            } catch {
              window.prompt("复制这个链接：", url);
            }
          } finally {
            setBusy(false);
          }
        }}
        className="surface-muted rounded-md px-3 py-2 text-sm transition hover:bg-ink-200 disabled:opacity-50 dark:hover:bg-ink-700"
      >
        {busy ? "..." : "分享"}
      </button>
      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-full bg-ink-900 px-4 py-2 text-sm text-white shadow-card-md dark:bg-accent-600"
    >
      {message}
    </div>
  );
}

function ExportButton({
  id,
  format,
  label,
  onError,
}: {
  id: string;
  format: "md" | "json" | "html";
  label: string;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        onError(null);
        try {
          const r = await fetch(`/api/room/${id}/export?format=${format}`, {
            headers: { "x-chorus-token": getOrCreateBrowserToken() },
          });
          if (!r.ok) {
            onError("导出失败");
            return;
          }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `chorus-${id}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } finally {
          setBusy(false);
        }
      }}
      className="surface-muted rounded-md px-3 py-2 text-sm transition hover:bg-ink-200 disabled:opacity-50 dark:hover:bg-ink-700"
    >
      {busy ? "导出中..." : label}
    </button>
  );
}

function QuoteCard({ text, speaker }: { text: string; speaker: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="surface rounded-xl border px-4 py-3">
      <p className="whitespace-pre-wrap leading-6">&ldquo;{text}&rdquo;</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500 dark:text-ink-400">— {speaker}</span>
        <div className="flex gap-3">
          <button
            onClick={() => downloadQuoteImage(text, speaker)}
            className="text-xs text-ink-400 transition hover:text-ink-900 dark:hover:text-ink-100"
          >
            保存图片
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setState("copied");
              } catch {
                setState("failed");
              }
              setTimeout(() => setState("idle"), 2000);
            }}
            className="text-xs text-ink-400 transition hover:text-ink-900 dark:hover:text-ink-100"
          >
            {state === "copied"
              ? "已复制"
              : state === "failed"
                ? "复制失败，请手动选中"
                : "复制"}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadQuoteImage(text: string, speaker: string): void {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const bg = dark ? "#0f172a" : "#f8fafc";
  const fg = dark ? "#f1f5f9" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";
  const accent = dark ? "#60a5fa" : "#2563eb";

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle accent bar on the left
  ctx.fillStyle = accent;
  ctx.fillRect(96, 96, 6, 240);

  // Quote text
  ctx.fillStyle = fg;
  ctx.font = '600 56px ui-sans-serif, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui';
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, `“${text}”`, SIZE - 192);
  let y = 360;
  for (const line of lines) {
    ctx.fillText(line, 144, y);
    y += 80;
  }

  // Speaker
  ctx.fillStyle = muted;
  ctx.font = '500 32px ui-sans-serif, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui';
  ctx.fillText(`— ${speaker}`, 144, y + 32);

  // Footer
  ctx.fillStyle = muted;
  ctx.font = '500 24px ui-sans-serif, system-ui';
  ctx.fillText("Chorus · 对话场", 96, SIZE - 96);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chorus-quote-${speaker}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/** Greedy word-wrap that handles CJK by falling back to per-character wrap. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  // Split first by whitespace, then wrap each piece per-char if needed.
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    const candidate = line + ch;
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      out.push(line);
      line = ch;
    } else {
      line = candidate;
    }
    if (ch === "\n") {
      out.push(line.replace(/\n$/, ""));
      line = "";
    }
  }
  if (line) out.push(line);
  return out;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface SummaryPayload {
  recap: string;
  role_observations: string[];
  user_highlights: string[];
  quotes: { speaker: string; text: string }[];
  follow_up_topics: string[];
}

interface RoomData {
  session: { id: string; mode: string; topic: string | null; role: { name: string; initials: string; color: string } };
  summary: SummaryPayload | null;
}

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RoomData | null>(null);

  useEffect(() => {
    void fetch(`/api/room/${id}`)
      .then((r) => r.json())
      .then((d) => setData(d));
  }, [id]);

  if (!data) return <main className="p-8 text-slate-400">加载中...</main>;
  const summary = data.summary;
  const roleName = data.session.role.name;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← 返回首页
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">会后总结</h1>

      {!summary ? (
        <p className="mt-8 text-slate-500">这次会话没有生成总结。</p>
      ) : (
        <div className="mt-8 space-y-8">
          <Section title="本轮聊了什么">
            <p className="leading-7 text-slate-800">{summary.recap}</p>
          </Section>
          {summary.role_observations.length > 0 && (
            <Section title={`${roleName}的关键观点`}>
              <ul className="list-disc space-y-1 pl-5 text-slate-800">
                {summary.role_observations.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          )}
          {summary.user_highlights.length > 0 && (
            <Section title="你的关键表达">
              <ul className="list-disc space-y-1 pl-5 text-slate-800">
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
                  <QuoteCard key={i} text={q.text} speaker={
                    q.speaker === "role" ? roleName : q.speaker === "host" ? "主持人" : "你"
                  } />
                ))}
              </div>
            </Section>
          )}
          {summary.follow_up_topics.length > 0 && (
            <Section title="可以继续聊的话题">
              <ul className="space-y-2">
                {summary.follow_up_topics.map((s, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2">
                    <span className="text-slate-800">{s}</span>
                    <Link
                      href={`/new?topic=${encodeURIComponent(s)}`}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      用这个开新房间
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="flex gap-3 border-t border-slate-200 pt-6">
            <a
              href={`/api/room/${id}/export`}
              className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              导出 Markdown
            </a>
            <Link
              href="/new"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
            >
              再来一场
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function QuoteCard({ text, speaker }: { text: string; speaker: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <p className="leading-6 text-slate-900">"{text}"</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-slate-500">— {speaker}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-xs text-slate-400 hover:text-slate-900"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  );
}

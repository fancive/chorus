import { NextRequest } from "next/server";
import {
  getOwnedSession,
  getSessionRolesAndTopic,
  getSummary,
  listMessages,
} from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { extractBrowserToken } from "@/lib/server/auth";
import { safeParseSummary } from "@/lib/prompts/host-summary";
import type { SummaryOutput } from "@/lib/prompts/host-summary";

export const runtime = "nodejs";

type ExportFormat = "md" | "json" | "html";

interface MessageRow {
  actor: "user" | "host" | "role";
  actorRoleIndex: number | null;
  content: string;
  status: string;
  seq: number;
  createdAt: Date;
}

interface ExportContext {
  sessionId: string;
  createdAt: Date;
  roles: { name: string; initials: string; color: string }[];
  topic: string | null;
  messages: MessageRow[];
  summary: SummaryOutput | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOwnedSession(id, extractBrowserToken(req));
  if (!session) return new Response("not found", { status: 404 });

  const format = (req.nextUrl.searchParams.get("format") ?? "md") as ExportFormat;
  if (!["md", "json", "html"].includes(format)) {
    return new Response("invalid format", { status: 400 });
  }

  const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  const [messages, summary] = await Promise.all([listMessages(id), getSummary(id)]);
  const ctx: ExportContext = {
    sessionId: session.id,
    createdAt: session.createdAt,
    roles: roles.map((r) => ({ name: r.name, initials: r.initials, color: r.color })),
    topic,
    messages,
    summary: summary ? safeParseSummary(summary.payloadJson) : null,
  };

  if (format === "json") return jsonResponse(ctx);
  if (format === "html") return htmlResponse(ctx);
  return mdResponse(ctx);
}

function speakerName(ctx: ExportContext, m: MessageRow): string {
  if (m.actor === "user") return "你";
  if (m.actor === "host") return "主持人";
  const idx = m.actorRoleIndex ?? 0;
  return ctx.roles[idx]?.name ?? `参会人${idx}`;
}

function jsonResponse(ctx: ExportContext): Response {
  const body = {
    session: {
      id: ctx.sessionId,
      createdAt: ctx.createdAt,
      topic: ctx.topic,
      roles: ctx.roles,
    },
    summary: ctx.summary,
    messages: ctx.messages.map((m) => ({
      seq: m.seq,
      actor: m.actor,
      actorRoleIndex: m.actorRoleIndex,
      speaker: speakerName(ctx, m),
      content: m.content,
      status: m.status,
      createdAt: m.createdAt,
    })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="chorus-${ctx.sessionId}.json"`,
    },
  });
}

function mdResponse(ctx: ExportContext): Response {
  const isDebate = ctx.roles.length > 1;
  const lines: string[] = [];
  lines.push(`# Chorus 对话场 — 会话总结`, "");
  lines.push(`- 参会人：${ctx.roles.map((r) => r.name).join(" / ")}`);
  if (ctx.topic) lines.push(`- 话题：${ctx.topic}`);
  lines.push(`- 时间：${new Date(ctx.createdAt).toLocaleString("zh-CN")}`, "");

  if (ctx.summary) {
    lines.push(`## 本轮聊了什么`, "", ctx.summary.recap, "");
    if (ctx.summary.role_observations.length) {
      lines.push(isDebate ? `## 参会人的关键观点` : `## ${ctx.roles[0].name}的关键观点`, "");
      ctx.summary.role_observations.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if (ctx.summary.user_highlights.length) {
      lines.push(`## 你的关键表达`, "");
      ctx.summary.user_highlights.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if (ctx.summary.quotes.length) {
      lines.push(`## 金句`, "");
      ctx.summary.quotes.forEach((q) => lines.push(`> ${q.text} — ${q.speaker}`));
      lines.push("");
    }
    if (ctx.summary.follow_up_topics.length) {
      lines.push(`## 可以继续聊的话题`, "");
      ctx.summary.follow_up_topics.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
  }

  lines.push(`---`, `## 完整对话`, "");
  for (const m of ctx.messages) {
    if (!m.content.trim()) continue;
    lines.push(
      `**${speakerName(ctx, m)}**：${m.content}${m.status === "interrupted" ? " *（被打断）*" : ""}`,
      "",
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="chorus-${ctx.sessionId}.md"`,
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(ctx: ExportContext): Response {
  const isDebate = ctx.roles.length > 1;
  const summaryHtml = ctx.summary
    ? `
        <section>
          <h2>本轮聊了什么</h2>
          <p>${escapeHtml(ctx.summary.recap)}</p>
        </section>
        ${ctx.summary.role_observations.length
          ? `<section><h2>${isDebate ? "参会人的关键观点" : `${escapeHtml(ctx.roles[0].name)}的关键观点`}</h2><ul>${ctx.summary.role_observations.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></section>`
          : ""}
        ${ctx.summary.user_highlights.length
          ? `<section><h2>你的关键表达</h2><ul>${ctx.summary.user_highlights.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></section>`
          : ""}
        ${ctx.summary.quotes.length
          ? `<section><h2>金句</h2>${ctx.summary.quotes.map((q) => `<blockquote>${escapeHtml(q.text)}<footer>— ${escapeHtml(q.speaker)}</footer></blockquote>`).join("")}</section>`
          : ""}
        ${ctx.summary.follow_up_topics.length
          ? `<section><h2>可以继续聊的话题</h2><ul>${ctx.summary.follow_up_topics.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></section>`
          : ""}
      `
    : "";

  const messagesHtml = ctx.messages
    .filter((m) => m.content.trim())
    .map((m) => {
      const isUser = m.actor === "user";
      const interrupted = m.status === "interrupted";
      return `
        <div class="msg ${isUser ? "msg-user" : "msg-ai"}">
          <div class="speaker">${escapeHtml(speakerName(ctx, m))}</div>
          <div class="bubble">${escapeHtml(m.content)}${interrupted ? '<span class="interrupted">（被打断）</span>' : ""}</div>
        </div>
      `;
    })
    .join("");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chorus 对话场 — ${escapeHtml(ctx.topic ?? ctx.roles.map((r) => r.name).join(" / "))}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #0f172a; background: #f8fafc; }
    @media (prefers-color-scheme: dark) { body { color: #f1f5f9; background: #0f172a; } }
    header { border-bottom: 1px solid currentColor; opacity: 1; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    h1 { margin: 0 0 .5rem; font-size: 1.75rem; }
    .meta { color: #64748b; font-size: .85rem; }
    section { margin: 1.5rem 0; }
    h2 { font-size: 1rem; letter-spacing: .15em; text-transform: uppercase; color: #64748b; margin: 0 0 .5rem; }
    blockquote { margin: .5rem 0; padding: .75rem 1rem; border-left: 3px solid #3b82f6; background: rgba(59,130,246,.08); border-radius: .25rem; }
    blockquote footer { display: block; margin-top: .25rem; font-size: .85rem; color: #64748b; }
    .msg { margin: 1rem 0; }
    .speaker { font-size: .75rem; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; margin-bottom: .25rem; }
    .bubble { padding: .75rem 1rem; border-radius: 1rem; background: #fff; border: 1px solid #e2e8f0; white-space: pre-wrap; }
    @media (prefers-color-scheme: dark) { .bubble { background: #1e293b; border-color: #334155; } }
    .msg-user { text-align: right; }
    .msg-user .bubble { background: #0f172a; color: #fff; display: inline-block; }
    @media (prefers-color-scheme: dark) { .msg-user .bubble { background: #2563eb; } }
    .interrupted { color: #d97706; font-size: .85rem; margin-left: .5rem; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(ctx.topic ?? "Chorus 对话")}</h1>
    <div class="meta">
      ${escapeHtml(ctx.roles.map((r) => r.name).join(" / "))} ·
      ${escapeHtml(new Date(ctx.createdAt).toLocaleString("zh-CN"))}
    </div>
  </header>
  ${summaryHtml}
  <section>
    <h2>完整对话</h2>
    ${messagesHtml}
  </section>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="chorus-${ctx.sessionId}.html"`,
    },
  });
}

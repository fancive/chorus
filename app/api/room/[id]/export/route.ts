import { NextRequest } from "next/server";
import { getSession, getSessionRoleAndTopic, getSummary, listMessages } from "@/lib/db/repo";
import { resolveRole } from "@/lib/prompts/role-builder";
import { MODE_LABEL } from "@/lib/scheduler/modes";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return new Response("not found", { status: 404 });
  }
  const { role: roleConfig, topic } = getSessionRoleAndTopic(session);
  const role = resolveRole(roleConfig);
  const messages = listMessages(id);
  const summary = getSummary(id);

  const lines: string[] = [];
  lines.push(`# Chorus 对话场 — 会话总结`);
  lines.push("");
  lines.push(`- 模式：${MODE_LABEL[session.mode]}`);
  lines.push(`- 角色：${role.name}`);
  if (topic) lines.push(`- 话题：${topic}`);
  lines.push(`- 时间：${new Date(session.createdAt).toLocaleString("zh-CN")}`);
  lines.push("");

  if (summary) {
    const payload = JSON.parse(summary.payloadJson) as {
      recap: string;
      role_observations: string[];
      user_highlights: string[];
      quotes: { speaker: string; text: string }[];
      follow_up_topics: string[];
    };
    lines.push(`## 本轮聊了什么`);
    lines.push("");
    lines.push(payload.recap);
    lines.push("");
    if (payload.role_observations.length) {
      lines.push(`## ${role.name}的关键观点`);
      lines.push("");
      payload.role_observations.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if (payload.user_highlights.length) {
      lines.push(`## 你的关键表达`);
      lines.push("");
      payload.user_highlights.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if (payload.quotes.length) {
      lines.push(`## 金句`);
      lines.push("");
      payload.quotes.forEach((q) => lines.push(`> ${q.text} — ${q.speaker === "role" ? role.name : q.speaker === "host" ? "主持人" : "你"}`));
      lines.push("");
    }
    if (payload.follow_up_topics.length) {
      lines.push(`## 可以继续聊的话题`);
      lines.push("");
      payload.follow_up_topics.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
  }

  lines.push(`---`);
  lines.push(`## 完整对话`);
  lines.push("");
  for (const m of messages) {
    if (!m.content.trim()) continue;
    const tag =
      m.actor === "user" ? "**你**" : m.actor === "host" ? "**主持人**" : `**${role.name}**`;
    lines.push(`${tag}：${m.content}${m.status === "interrupted" ? " *（被打断）*" : ""}`);
    lines.push("");
  }

  const md = lines.join("\n");
  const filename = `chorus-${session.id}.md`;
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
    },
  });
}

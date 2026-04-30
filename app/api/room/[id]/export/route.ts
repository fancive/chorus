import { NextRequest } from "next/server";
import { getOwnedSession, getSessionRolesAndTopic, getSummary, listMessages } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { extractBrowserToken } from "@/lib/server/auth";
import { safeParseSummary } from "@/lib/prompts/host-summary";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getOwnedSession(id, extractBrowserToken(req));
  if (!session) {
    return new Response("not found", { status: 404 });
  }
  const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  const messages = listMessages(id);
  const summary = getSummary(id);

  const isDebate = roles.length > 1;
  const speakerName = (m: { actor: string; actorRoleIndex: number | null }) => {
    if (m.actor === "user") return "你";
    if (m.actor === "host") return "主持人";
    const idx = m.actorRoleIndex ?? 0;
    return roles[idx]?.name ?? `参会人${idx}`;
  };

  const lines: string[] = [];
  lines.push(`# Chorus 对话场 — 会话总结`);
  lines.push("");
  lines.push(`- 参会人：${roles.map((r) => r.name).join(" / ")}`);
  if (topic) lines.push(`- 话题：${topic}`);
  lines.push(`- 时间：${new Date(session.createdAt).toLocaleString("zh-CN")}`);
  lines.push("");

  const payload = summary ? safeParseSummary(summary.payloadJson) : null;
  if (payload) {
    lines.push(`## 本轮聊了什么`);
    lines.push("");
    lines.push(payload.recap);
    lines.push("");
    if (payload.role_observations.length) {
      lines.push(isDebate ? `## 参会人的关键观点` : `## ${roles[0].name}的关键观点`);
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
      payload.quotes.forEach((q) => {
        lines.push(`> ${q.text} — ${q.speaker}`);
      });
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
    lines.push(`**${speakerName(m)}**：${m.content}${m.status === "interrupted" ? " *（被打断）*" : ""}`);
    lines.push("");
  }

  const md = lines.join("\n");
  const filename = `chorus-${session.id}.md`;
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

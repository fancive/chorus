import type { Message } from "@/lib/db/schema";
import type { ChorusMessage } from "@/lib/providers";
import type { ResolvedRole } from "@/lib/prompts/role-builder";

export type ActorView = "host_scheduler" | "host_speaker" | "role_speaker";

export interface ProjectionInput {
  history: Message[];
  hostIdentity: string;
  role: ResolvedRole;
}

function speakerLabel(actor: Message["actor"], roleName: string): string {
  switch (actor) {
    case "user":
      return "用户";
    case "host":
      return "主持人";
    case "role":
      return roleName;
  }
}

function renderHistoryAsAssistantContext(
  history: Message[],
  roleName: string,
  hideInterruptedMeta: boolean,
): string {
  const lines: string[] = [];
  for (const m of history) {
    if (!m.content.trim()) continue;
    const tag = speakerLabel(m.actor, roleName);
    const suffix =
      m.status === "interrupted" && !hideInterruptedMeta ? " [被用户打断]" : "";
    lines.push(`${tag}：${m.content}${suffix}`);
  }
  return lines.join("\n");
}

export function projectForHostScheduler(input: ProjectionInput): ChorusMessage[] {
  const transcript = renderHistoryAsAssistantContext(
    input.history,
    input.role.name,
    false,
  );
  return [
    { role: "system", content: input.hostIdentity },
    {
      role: "user",
      content: `[完整对话历史]\n${transcript || "（暂无）"}`,
    },
  ];
}

export function projectForHostSpeaker(input: ProjectionInput): ChorusMessage[] {
  const messages: ChorusMessage[] = [
    { role: "system", content: input.hostIdentity },
  ];
  for (const m of input.history) {
    if (!m.content.trim()) continue;
    if (m.actor === "host") {
      messages.push({ role: "assistant", content: m.content });
    } else if (m.actor === "user") {
      messages.push({ role: "user", content: `[用户] ${m.content}` });
    } else {
      messages.push({
        role: "user",
        content: `[${input.role.name}] ${m.content}${m.status === "interrupted" ? " [被打断]" : ""}`,
      });
    }
  }
  return messages;
}

export function projectForRoleSpeaker(input: ProjectionInput): ChorusMessage[] {
  const messages: ChorusMessage[] = [
    { role: "system", content: input.role.systemPrompt },
  ];
  for (const m of input.history) {
    if (!m.content.trim()) continue;
    if (m.actor === "role") {
      messages.push({ role: "assistant", content: m.content });
    } else if (m.actor === "user") {
      messages.push({ role: "user", content: m.content });
    } else {
      messages.push({
        role: "user",
        content: `[主持人] ${m.content}`,
      });
    }
  }
  return messages;
}

export function projectForSummary(input: ProjectionInput): ChorusMessage[] {
  const transcript = renderHistoryAsAssistantContext(
    input.history,
    input.role.name,
    true,
  );
  return [
    { role: "system", content: input.hostIdentity },
    { role: "user", content: `[完整对话历史]\n${transcript}` },
  ];
}

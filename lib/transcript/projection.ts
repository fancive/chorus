import type { Message } from "@/lib/db/schema";
import type { ChorusMessage } from "@/lib/providers";
import type { ResolvedRole } from "@/lib/prompts/role-builder";

export interface ProjectionInput {
  history: Message[];
  hostIdentity: string;
  roles: ResolvedRole[];
}

function speakerLabel(m: Message, roles: ResolvedRole[]): string {
  switch (m.actor) {
    case "user":
      return "用户";
    case "host":
      return "主持人";
    case "role": {
      const idx = m.actorRoleIndex ?? 0;
      return roles[idx]?.name ?? `参会人${idx}`;
    }
  }
}

function renderHistoryAsText(
  history: Message[],
  roles: ResolvedRole[],
  hideInterruptedMeta: boolean,
): string {
  const lines: string[] = [];
  for (const m of history) {
    if (!m.content.trim()) continue;
    const tag = speakerLabel(m, roles);
    const suffix =
      m.status === "interrupted" && !hideInterruptedMeta ? " [被用户打断]" : "";
    lines.push(`${tag}：${m.content}${suffix}`);
  }
  return lines.join("\n");
}

export function projectForHostScheduler(input: ProjectionInput): ChorusMessage[] {
  const transcript = renderHistoryAsText(input.history, input.roles, false);
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
      const idx = m.actorRoleIndex ?? 0;
      const name = input.roles[idx]?.name ?? `参会人${idx}`;
      messages.push({
        role: "user",
        content: `[${name}] ${m.content}`,
      });
    }
  }
  return messages;
}

/**
 * Project history for a specific role speaker. The role at `selfIndex`
 * sees its own past lines as `assistant`, and everyone else's lines as
 * `user` with explicit name labels (so it can react to other participants).
 */
export function projectForRoleSpeaker(
  input: ProjectionInput,
  selfIndex: number,
): ChorusMessage[] {
  const self = input.roles[selfIndex];
  if (!self) throw new Error(`role index ${selfIndex} out of range`);
  const messages: ChorusMessage[] = [
    { role: "system", content: self.systemPrompt },
  ];
  for (const m of input.history) {
    if (!m.content.trim()) continue;
    if (m.actor === "role" && (m.actorRoleIndex ?? 0) === selfIndex) {
      messages.push({ role: "assistant", content: m.content });
    } else if (m.actor === "user") {
      messages.push({ role: "user", content: `[用户] ${m.content}` });
    } else if (m.actor === "host") {
      messages.push({ role: "user", content: `[主持人] ${m.content}` });
    } else {
      const idx = m.actorRoleIndex ?? 0;
      const name = input.roles[idx]?.name ?? `参会人${idx}`;
      messages.push({
        role: "user",
        content: `[${name}] ${m.content}`,
      });
    }
  }
  return messages;
}

export function projectForSummary(input: ProjectionInput): ChorusMessage[] {
  const transcript = renderHistoryAsText(input.history, input.roles, true);
  return [
    { role: "system", content: input.hostIdentity },
    { role: "user", content: `[完整对话历史]\n${transcript}` },
  ];
}

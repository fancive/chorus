import { z } from "zod";
import { MODE_LABEL, type Mode } from "@/lib/scheduler/modes";

/** Dynamic next-speaker tag.  "host" / "await_user" / "role_0" / "role_1" / "role_2" */
export type NextSpeakerTag = "host" | "await_user" | `role_${number}`;

/** Build a Zod schema with the right enum based on participant count. */
export function buildSchedulerOutput(roleCount: number) {
  const tags: [string, ...string[]] = [
    "host",
    "await_user",
    ...Array.from({ length: roleCount }, (_, i) => `role_${i}`),
  ] as [string, ...string[]];

  return z.object({
    next_speaker: z
      .enum(tags)
      .describe(
        "下一个发言者的标签：host=主持人；role_0/role_1/...=对应的参会人；await_user=等用户开口",
      ),
    reason: z
      .string()
      .max(120)
      .describe("为什么这样调度，一句话内说明，仅你内部可见"),
    status_bar_hint: z
      .string()
      .max(40)
      .describe("给前端状态条显示的轻提示，可为空字符串"),
  });
}

export type SchedulerOutput<T extends string> = {
  next_speaker: T;
  reason: string;
  status_bar_hint: string;
};

export type DebateFlavor = "natural" | "strict" | "freefire";

export interface SchedulerContext {
  mode: Mode;
  roles: { name: string; talkativeness?: number }[];
  aiStreak: number;
  userJustSpoke: boolean;
  isColdStart: boolean;
  lastInterrupted: boolean;
  lastSpeakerLabel: string;
  lastRoleIndex: number | null;
  /** If the last host utterance addressed a participant by name, the index of that participant. */
  addressedRoleIndex: number | null;
  debateFlavor?: DebateFlavor;
}

export function buildSchedulerTask(ctx: SchedulerContext): string {
  const isDebate = ctx.roles.length > 1;
  const hasTalkativeness = ctx.roles.some(
    (r) => typeof r.talkativeness === "number" && r.talkativeness !== 50,
  );
  const roleListLines = ctx.roles.map((r, i) => {
    const t = r.talkativeness;
    if (typeof t !== "number" || t === 50) return `- role_${i} = ${r.name}`;
    return `- role_${i} = ${r.name}（活跃度 ${t}/100）`;
  });

  const lines: string[] = [
    "---",
    "现在你切到【调度模式】。不要发言，只决定下一个发言者。",
    "",
    "本场参会人：",
    ...roleListLines,
    "",
    `当前状态：`,
    `- 模式：${MODE_LABEL[ctx.mode]}`,
    `- 上一句发言者：${ctx.lastSpeakerLabel}`,
    `- 用户刚发言：${ctx.userJustSpoke ? "是" : "否"}`,
    `- 是否冷启动：${ctx.isColdStart ? "是" : "否"}`,
    `- AI 已连续发言 ${ctx.aiStreak} 轮`,
    `- 用户刚才打断过：${ctx.lastInterrupted ? "是" : "否"}`,
    "",
    "硬规则：",
    isDebate
      ? "- 如果 AI 已连续发言 ≥ 4 轮，必须返回 await_user"
      : "- 如果 AI 已连续发言 ≥ 3 轮，必须返回 await_user",
    "- 如果用户刚发言，下一个一般不应该是 await_user（除非他的话本身就是闲聊收尾）",
    "- 冷启动时应该是 host 开场",
    ctx.lastRoleIndex !== null
      ? `- 上一句是 role_${ctx.lastRoleIndex}（${ctx.roles[ctx.lastRoleIndex]?.name}），下一句不能再是同一位参会人`
      : "",
    ctx.addressedRoleIndex !== null
      ? `- 上一句 host 已经明确点名 role_${ctx.addressedRoleIndex}（${ctx.roles[ctx.addressedRoleIndex]?.name}）接话，next_speaker 必须返回 role_${ctx.addressedRoleIndex}`
      : "",
    "",
    "模式调度倾向：",
    ctx.mode === "interview"
      ? "- 访谈模式：优先让参会人回答和展开，host 主要负责追问或转场"
      : "",
    ctx.mode === "dialogue"
      ? "- 对谈模式：优先让参会人和用户直接对话，host 只在节奏断掉时介入"
      : "",
    ctx.mode === "coach"
      ? "- 教练模式：host 可以更主动拆解问题，但每次只推进一个小步骤，然后让参会人给反馈"
      : "",
    "",
    isDebate
      ? "辩论场调度倾向："
      : "调度倾向（host 应尽量沉默）：",
    isDebate ? "- 让参会人之间互相回应，不要让对话变成纯问答串行" : "",
    isDebate ? "- 用户刚发言后，挑一位参会人接话；下一轮可以让另一位反驳或补充" : "",
    isDebate ? "- host 可以在一两轮交锋后 cue 另一位参会人换角度，但不要每轮都出场" : "",
    !isDebate ? "- 中段优先在 role 和 await_user 之间选，不要让 host 频繁出场" : "",
    !isDebate ? "- 用户刚发言后，绝大多数情况下是 role 接话" : "",
    "- 不要连续两轮都是 host",
    hasTalkativeness
      ? "- 在不违反上面的硬规则前提下，活跃度高的参会人应当被更频繁选中（活跃度 80+ 偏好抢答；活跃度 20- 倾向被点名才出现）"
      : "",
    isDebate && ctx.debateFlavor === "strict"
      ? "- 严格轮次模式：参会人之间必须严格交替（A → B → A → B），host 仅在用户介入或卡壳时出场；用户刚发言后挑离上轮最远的那位"
      : "",
    isDebate && ctx.debateFlavor === "freefire"
      ? "- 自由开火模式：host 几乎不出场（除非冷场或用户被冷落），每轮在参会人里挑活跃度最高 / 与上一句对立最强的那位接话"
      : "",
    "",
    "next_speaker 字段只能填以下英文字面量之一：",
    `- "host"（主持人接话）`,
    `- "await_user"（等用户开口）`,
    ...ctx.roles.map((r, i) => `- "role_${i}"（让 ${r.name} 发言）`),
    "不要填参会人的名字，不要填 \"role\"，必须用 role_0 / role_1 / role_2 这种带索引的标签。",
    "",
    "返回 JSON：next_speaker / reason / status_bar_hint。",
  ].filter(Boolean);
  return lines.join("\n");
}

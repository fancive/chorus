import { z } from "zod";

export const NextSpeaker = z.enum(["host", "role", "await_user"]);
export type NextSpeaker = z.infer<typeof NextSpeaker>;

export const SchedulerOutput = z.object({
  next_speaker: NextSpeaker.describe(
    "下一个发言者：host=主持人接话；role=让角色发言；await_user=等用户开口",
  ),
  reason: z
    .string()
    .max(120)
    .describe("为什么这样调度，一句话内说明，仅你内部可见"),
  status_bar_hint: z
    .string()
    .max(40)
    .describe("给前端状态条显示的轻提示，比如 \"角色想补充\"，可为空字符串"),
});
export type SchedulerOutput = z.infer<typeof SchedulerOutput>;

export interface SchedulerContext {
  aiStreak: number;
  userJustSpoke: boolean;
  isColdStart: boolean;
  lastInterrupted: boolean;
  roleName: string;
}

export function buildSchedulerTask(ctx: SchedulerContext): string {
  const lines: string[] = [
    "---",
    "现在你切到【调度模式】。不要发言，只决定下一个发言者。",
    "",
    `当前状态：`,
    `- 角色名：${ctx.roleName}`,
    `- 用户刚发言：${ctx.userJustSpoke ? "是" : "否"}`,
    `- 是否冷启动：${ctx.isColdStart ? "是（这是会话第一句话）" : "否"}`,
    `- AI 已连续发言 ${ctx.aiStreak} 轮`,
    `- 用户刚才打断过：${ctx.lastInterrupted ? "是（说明上一段不合他意，下一步要更小心）" : "否"}`,
    "",
    "硬规则：",
    "- 如果 AI 已连续发言 ≥ 3 轮，必须返回 await_user",
    "- 如果用户刚发言，下一个一般不应该是 await_user（除非他的话本身就是闲聊收尾）",
    "- 冷启动时通常应该是 host 开场",
    "",
    "返回 JSON：next_speaker / reason / status_bar_hint。",
  ];
  return lines.join("\n");
}

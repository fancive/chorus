import { MODE_LABEL, type Mode } from "@/lib/scheduler/modes";

export interface SpeakerContext {
  mode: Mode;
  isColdStart: boolean;
  schedulerReason: string;
  roleNames: string[];
  topic: string | null;
}

export function buildHostSpeakerTask(ctx: SpeakerContext): string {
  const isDebate = ctx.roleNames.length > 1;
  const participantsClause = isDebate
    ? `本场参会人：${ctx.roleNames.map((n) => `「${n}」`).join("、")}`
    : `本场参会人：${ctx.roleNames[0]}`;

  if (ctx.isColdStart) {
    return [
      "---",
      "现在请你做开场白。",
      participantsClause,
      `模式：${MODE_LABEL[ctx.mode]}`,
      ctx.topic ? `话题：${ctx.topic}` : "",
      "要求：",
      isDebate
        ? "- 2-3 句话，介绍每位参会人（一句一人）和话题，预告这是一场辩论"
        : "- 1-2 句话，介绍参会人和话题",
      ctx.mode === "coach" ? "- 点明你会帮用户把问题拆小，不要一上来给结论" : "",
      ctx.mode === "interview" ? "- 像访谈开场，把第一颗球抛给参会人或用户" : "",
      "- 让用户感到被欢迎，但不要寒暄太多",
      "- 最后用一句话引导用户开口或抛给某位参会人",
      "- 不要使用 markdown",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "---",
    "现在请你作为主持人发言。",
    participantsClause,
    `模式：${MODE_LABEL[ctx.mode]}`,
    `内部调度判断：${ctx.schedulerReason}`,
    "要求：",
    "- 1-2 句话，短，节奏感强",
    "- 不要重复刚才已经说过的内容",
    ctx.mode === "coach"
      ? "- 教练模式下可以提出一个小拆解或行动方向，但不要变成长篇建议"
      : "",
    ctx.mode === "interview"
      ? "- 访谈模式下优先追问或转交参会人，不要自己替参会人回答"
      : "",
    isDebate
      ? "- 你这一句里只能选一个方向：要么点名一位参会人接话（最后一句话以那位的名字+提问结尾），要么把球抛给用户（明确请用户开口）；不要在同一句里既邀请参会人又问用户"
      : "- 你可以是引导、转场、轻总结、防冷场；如果想让参会人接话，就明确点名他",
    "- 不要使用 markdown",
  ].join("\n");
}

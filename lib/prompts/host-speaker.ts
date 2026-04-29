export interface SpeakerContext {
  isColdStart: boolean;
  schedulerReason: string;
  roleName: string;
  topic: string | null;
}

export function buildHostSpeakerTask(ctx: SpeakerContext): string {
  if (ctx.isColdStart) {
    return [
      "---",
      "现在请你做开场白。要求：",
      `- 1-2 句话，介绍当前的对话角色（${ctx.roleName}）${ctx.topic ? `和话题（${ctx.topic}）` : ""}`,
      "- 让用户感到被欢迎，但不要寒暄太多",
      "- 最后用一句话引导用户开口（提一个具体问题或邀请）",
      "- 不要使用 markdown 格式",
    ].join("\n");
  }
  return [
    "---",
    "现在请你作为主持人发言。",
    `内部调度判断：${ctx.schedulerReason}`,
    "要求：",
    "- 1-2 句话，短，节奏感强",
    "- 不要重复用户或角色刚说过的内容",
    "- 你可以是引导、转场、轻总结、防冷场",
    "- 不要使用 markdown 格式",
  ].join("\n");
}

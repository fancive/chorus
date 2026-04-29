export const MODES = ["interview", "dialogue", "coach"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABEL: Record<Mode, string> = {
  interview: "访谈模式",
  dialogue: "对谈模式",
  coach: "教练模式",
};

export const MODE_DESCRIPTION: Record<Mode, string> = {
  interview: "主持人采访角色，你随时插话",
  dialogue: "你和角色对话，主持人偶尔引导",
  coach: "主持人帮你拆问题，角色从某种视角给反馈",
};

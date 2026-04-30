export const MODES = ["interview", "dialogue", "coach"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABEL: Record<Mode, string> = {
  interview: "访谈模式",
  dialogue: "对谈模式",
  coach: "教练模式",
};

export const MODE_DESCRIPTION: Record<Mode, string> = {
  interview: "主持人像记者，更多把问题抛给参会人",
  dialogue: "参会人和你直接对话，主持人轻控节奏",
  coach: "主持人帮助拆解问题，参会人提供具体反馈",
};

export const MODE_OPTIONS = MODES.map((id) => ({
  id,
  label: MODE_LABEL[id],
  description: MODE_DESCRIPTION[id],
}));

export function normalizeMode(value: string | null | undefined): Mode {
  if (value === "interviewee") return "interview";
  if (value === "participant") return "dialogue";
  if (MODES.includes(value as Mode)) return value as Mode;
  return "dialogue";
}

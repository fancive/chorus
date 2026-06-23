import { z } from "zod";

export const SummaryOutput = z.object({
  recap: z.string().describe("本轮聊了什么，2-3 句话"),
  role_observations: z
    .array(z.string())
    .max(5)
    .describe("参会人给了哪些关键观点，要点列表，每条短"),
  user_highlights: z
    .array(z.string())
    .max(3)
    .describe("用户的关键表达，1-2 条"),
  /**
   * For debate sessions (≥ 2 participants) the model lists each participant's
   * core stance side-by-side. One entry per participant; empty array for solo.
   */
  stances: z
    .array(
      z.object({
        speaker: z.string().max(40),
        position: z
          .string()
          .max(80)
          .describe("一句话总结这位参会人的核心立场，是支持/反对/折中/转向"),
        keyArgument: z
          .string()
          .max(140)
          .describe("最有说服力的一条论据或例子，原文摘录或小幅压缩"),
      }),
    )
    .max(4)
    .describe("辩论场每位参会人的立场对照；单人对话必须给空数组 []"),
  quotes: z
    .array(
      z.object({
        speaker: z
          .string()
          .max(40)
          .describe(
            "金句的发言者名字。用户写 \"用户\"，主持人写 \"主持人\"，参会人写他们的真名（如 \"苏格拉底\"、\"Warren Buffett\"），不要用 user/host/role 这种代号",
          ),
        text: z.string().max(140),
      }),
    )
    .max(3)
    .describe("从对话里挑 1-3 句最能被分享出去的话（金句），原文摘录"),
  follow_up_topics: z
    .array(z.string())
    .max(3)
    .describe("接下来可以继续追问的 1-3 个话题"),
});
export type SummaryOutput = z.infer<typeof SummaryOutput>;

export function safeParseSummary(json: string): SummaryOutput | null {
  try {
    const parsed = SummaryOutput.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const SUMMARY_TASK = `
---
现在请你做会后总结。基于上面完整的对话历史，输出结构化 JSON 总结。

严格按以下 JSON 形状返回（注意 quotes 是对象数组，每个对象有 speaker 和 text 两个字段）：

{
  "recap": "本轮聊了什么，2-3 句话",
  "role_observations": ["参会人的关键观点1", "观点2"],
  "user_highlights": ["用户的关键表达1"],
  "stances": [
    {"speaker": "苏格拉底", "position": "认为...", "keyArgument": "代表性论据..."},
    {"speaker": "Warren Buffett", "position": "反对认为...", "keyArgument": "代表性论据..."}
  ],
  "quotes": [
    {"speaker": "用户", "text": "原文摘录"},
    {"speaker": "苏格拉底", "text": "原文摘录"}
  ],
  "follow_up_topics": ["可以接着聊的话题1", "话题2"]
}

要求：
- 所有列表字段必须是数组，即使只有一项也要包成数组；为空就用 []
- quotes 的 speaker 写真名："用户"、"主持人"、或参会人的真名（多人辩论时一定要分清是哪一位说的）；不要用 user/host/role 这种代号
- stances 仅在多人辩论场（≥ 2 位参会人）填，单人对话给 []；每位参会人一条，position 必须明确表态（支持 / 反对 / 折中 / 不同视角）；keyArgument 引用他们最有力的一句论据
- recap 用平实的语气，不要客套
- role_observations 要从参会人身上提炼，多人辩论时可以在条目里点名是哪位的观点（如"苏格拉底认为..."），不要泛泛而谈
- quotes 必须是对话原文的摘录，不要改写
- follow_up_topics 要具体到能直接当下次对话的开场话题
- 仅返回 JSON 对象，不要任何解释性文字
`;

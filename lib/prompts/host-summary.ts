import { z } from "zod";

export const SummaryOutput = z.object({
  recap: z.string().describe("本轮聊了什么，2-3 句话"),
  role_observations: z
    .array(z.string())
    .max(5)
    .describe("角色给了哪些关键观点，要点列表，每条短"),
  user_highlights: z
    .array(z.string())
    .max(3)
    .describe("用户的关键表达，1-2 条"),
  quotes: z
    .array(
      z.object({
        speaker: z.enum(["user", "host", "role"]),
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

export const SUMMARY_TASK = `
---
现在请你做会后总结。基于上面完整的对话历史，输出结构化总结。

要求：
- recap 用平实的语气，不要客套
- role_observations 要从角色身上提炼，不要泛泛而谈
- quotes 必须是对话原文的摘录，不要改写
- follow_up_topics 要具体到能直接当下次对话的开场话题
`;

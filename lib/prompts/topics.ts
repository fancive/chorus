export const TOPIC_POOL: string[] = [
  "科技发展会让人类更自由还是更不自由",
  "个人成功更多靠运气还是努力",
  "工作的意义是赚钱还是自我实现",
  "AI 会取代大部分人类的工作吗",
  "钱能买到幸福吗",
  "应该追求专精还是博学",
  "教育的目的是培养独立思考还是传授知识",
  "应该相信直觉还是数据",
  "婚姻在今天是否仍然必要",
  "城市生活和乡村生活哪种更好",
  "活在当下还是为未来打算",
  "天才是天生的还是练出来的",
  "苦难是成长的必需还是可以避免的",
  "自由意志真的存在吗",
  "人应该追求快乐还是追求意义",
];

export function pickRandomTopics(n: number): string[] {
  const pool = [...TOPIC_POOL];
  const out: string[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

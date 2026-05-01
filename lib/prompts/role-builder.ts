import {
  DimensionSelection,
  DIMENSION_KEYS,
  getDimensionPrompt,
} from "./dimensions";
import { ROLE_TEMPLATES, type RoleTemplate, getRoleTemplate } from "./role-templates";

export type RoleConfig =
  | { kind: "template"; templateId: string }
  | {
      kind: "custom";
      name: string;
      initials: string;
      color: string;
      dimensions: DimensionSelection;
    };

export interface ResolvedRole {
  name: string;
  initials: string;
  color: string;
  systemPrompt: string;
}

export function resolveRole(config: RoleConfig): ResolvedRole {
  if (config.kind === "template") {
    const tpl = getRoleTemplate(config.templateId);
    if (!tpl) throw new Error(`Unknown role template: ${config.templateId}`);
    return {
      name: tpl.name,
      initials: tpl.initials,
      color: tpl.color,
      systemPrompt: tpl.systemPrompt,
    };
  }

  const fragments: string[] = [`你扮演一位名为"${config.name}"的角色。`, ""];
  for (const key of DIMENSION_KEYS) {
    const value = config.dimensions[key];
    const piece = getDimensionPrompt(key, value);
    if (piece) fragments.push(`- ${piece}`);
  }
  if (config.dimensions.freeform?.trim()) {
    fragments.push("", "补充设定：", config.dimensions.freeform.trim());
  }
  fragments.push(
    "",
    "长度与密度（硬要求）：",
    "- 一段话，2-4 句，60-150 字之间",
    "- 每次发言必须包含：一个具体观点 + 至少一条支撑（论据 / 例子 / 类比 / 反驳）",
    "- 禁止只反问而不表态，禁止只附和",
    "",
    "格式约束：",
    "- 不输出 markdown",
    "- 保持人设一致，不要跳出角色解释",
  );
  return {
    name: config.name,
    initials: config.name.slice(0, 1),
    color: config.color,
    systemPrompt: fragments.join("\n"),
  };
}

export function resolveRoles(configs: readonly RoleConfig[]): ResolvedRole[] {
  return configs.map((c) => resolveRole(c));
}

/**
 * Decorate a role's base systemPrompt with awareness of the other participants
 * in the room. The role at `selfIndex` will be told the names of the others
 * and that it can react to / disagree with them.
 */
export function withDebateContext(
  roles: readonly ResolvedRole[],
  selfIndex: number,
): ResolvedRole {
  const self = roles[selfIndex];
  const others = roles.filter((_, i) => i !== selfIndex);
  if (others.length === 0) return self;
  const otherNames = others.map((r) => `「${r.name}」`).join("、");
  const ctx = `

---
本场是辩论场，除你之外还有其他参会人：${otherNames}。

- 这是辩论，必须明确表态：支持 / 反对 / 补充 / 转向，至少占一句
- 直接回应他们刚才的发言，不要泛泛而谈；提到他们时用名字称呼
- 禁止只把球踢给别人（"那你说呢？"）：先表态，再反问
- 不要重复别人已经说过的话，要么推进，要么挑战
- 仍然保持你自己的人设，不要被别人带跑`;
  return { ...self, systemPrompt: self.systemPrompt + ctx };
}

export { ROLE_TEMPLATES };
export type { RoleTemplate };

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
    "通用约束：",
    "- 单次发言不超过 3-4 句",
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

- 你可以直接回应他们刚才的发言：认同、反驳、补充、追问
- 提到他们时用名字称呼，让用户能跟得上谁在跟谁说话
- 不要重复别人已经说过的话，要么推进，要么挑战
- 仍然保持你自己的人设，不要被别人带跑`;
  return { ...self, systemPrompt: self.systemPrompt + ctx };
}

export { ROLE_TEMPLATES };
export type { RoleTemplate };

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

export { ROLE_TEMPLATES };
export type { RoleTemplate };

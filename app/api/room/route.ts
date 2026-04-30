import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureUser, createSession } from "@/lib/db/repo";
import { MODES } from "@/lib/scheduler/modes";
import { DimensionSelection } from "@/lib/prompts/dimensions";
import { resolveRoles } from "@/lib/prompts/role-builder";

export const runtime = "nodejs";

const TemplateRole = z.object({
  kind: z.literal("template"),
  templateId: z.string(),
});
const CustomRole = z.object({
  kind: z.literal("custom"),
  name: z.string().min(1).max(40),
  initials: z.string().min(1).max(2).optional(),
  color: z.string().optional(),
  dimensions: DimensionSelection,
});
const RoleEntry = z.discriminatedUnion("kind", [TemplateRole, CustomRole]);

const CreateRoomBody = z.object({
  browserToken: z.string().min(8),
  nickname: z.string().optional(),
  mode: z.enum(MODES).default("dialogue"),
  topic: z.string().max(300).optional(),
  // Accept either single (legacy) or array of 1-3
  role: RoleEntry.optional(),
  roles: z.array(RoleEntry).min(1).max(3).optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = CreateRoomBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;
  if (!body.role && !body.roles) {
    return NextResponse.json({ error: "missing_role_or_roles" }, { status: 400 });
  }
  const user = await ensureUser({
    browserToken: body.browserToken,
    nickname: body.nickname,
  });

  const incoming = body.roles ?? (body.role ? [body.role] : []);
  const roleConfigs = incoming.map((r) =>
    r.kind === "custom"
      ? {
          kind: "custom" as const,
          name: r.name,
          initials: r.initials || r.name.slice(0, 1),
          color: r.color || "#6366f1",
          dimensions: r.dimensions,
        }
      : r,
  );
  try {
    resolveRoles(roleConfigs);
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_role",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const session = createSession({
    userId: user.id,
    mode: body.mode,
    roleConfigs,
    topic: body.topic?.trim() || null,
  });
  return NextResponse.json({ id: session.id });
}

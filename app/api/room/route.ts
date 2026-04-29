import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureUser, createSession } from "@/lib/db/repo";
import { MODES } from "@/lib/scheduler/modes";
import { DimensionSelection } from "@/lib/prompts/dimensions";

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

const CreateRoomBody = z.object({
  browserToken: z.string().min(8),
  nickname: z.string().optional(),
  mode: z.enum(MODES),
  topic: z.string().max(300).optional(),
  role: z.discriminatedUnion("kind", [TemplateRole, CustomRole]),
});

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = CreateRoomBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const user = await ensureUser({
    browserToken: body.browserToken,
    nickname: body.nickname,
  });
  const role =
    body.role.kind === "custom"
      ? {
          kind: "custom" as const,
          name: body.role.name,
          initials: body.role.initials || body.role.name.slice(0, 1),
          color: body.role.color || "#6366f1",
          dimensions: body.role.dimensions,
        }
      : body.role;
  const session = createSession({
    userId: user.id,
    mode: body.mode,
    roleConfig: role,
    topic: body.topic ?? null,
  });
  return NextResponse.json({ id: session.id });
}

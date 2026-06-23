import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureUser, createSession } from "@/lib/db/repo";
import { DEBATE_FLAVORS, MODES } from "@/lib/scheduler/modes";
import { DimensionSelection } from "@/lib/prompts/dimensions";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { extractBrowserToken } from "@/lib/server/auth";
import { envGate } from "@/lib/server/env-gate";
import { withRequestLog } from "@/lib/server/logger";

export const runtime = "nodejs";

const Talkativeness = z.number().int().min(0).max(100).optional();
const TemplateRole = z.object({
  kind: z.literal("template"),
  templateId: z.string(),
  talkativeness: Talkativeness,
});
const CustomRole = z.object({
  kind: z.literal("custom"),
  name: z.string().min(1).max(40),
  initials: z.string().min(1).max(2).optional(),
  color: z.string().optional(),
  dimensions: DimensionSelection,
  talkativeness: Talkativeness,
});
const RoleEntry = z.discriminatedUnion("kind", [TemplateRole, CustomRole]);

const CreateRoomBody = z.object({
  nickname: z.string().max(50).optional(),
  mode: z.enum(MODES).default("dialogue"),
  topic: z.string().max(300).optional(),
  debateFlavor: z.enum(DEBATE_FLAVORS).optional(),
  // Accept either single (legacy) or array of 1-3
  role: RoleEntry.optional(),
  roles: z.array(RoleEntry).min(1).max(3).optional(),
});

export const POST = withRequestLog("POST /api/room", async (req: NextRequest) => {
  const gate = envGate("POST /api/room");
  if (gate) return gate;
  // Identity comes from the header only — never the body — so a leaked token
  // can't be replayed as someone else's via a crafted payload.
  const browserToken = extractBrowserToken(req);
  if (browserToken.length < 8) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
    browserToken,
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
          talkativeness: r.talkativeness,
        }
      : { kind: "template" as const, templateId: r.templateId, talkativeness: r.talkativeness },
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

  const session = await createSession({
    userId: user.id,
    mode: body.mode,
    roleConfigs,
    topic: body.topic?.trim() || null,
    debateFlavor: body.debateFlavor,
  });
  return NextResponse.json({ id: session.id });
});

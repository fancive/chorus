import { NextResponse } from "next/server";
import { ROLE_TEMPLATES } from "@/lib/prompts/role-templates";
import { DIMENSIONS } from "@/lib/prompts/dimensions";
import { MODES, MODE_DESCRIPTION, MODE_LABEL } from "@/lib/scheduler/modes";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    modes: MODES.map((m) => ({
      id: m,
      label: MODE_LABEL[m],
      description: MODE_DESCRIPTION[m],
    })),
    templates: ROLE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      initials: t.initials,
      color: t.color,
    })),
    dimensions: DIMENSIONS,
  });
}

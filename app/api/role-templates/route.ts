import { NextResponse } from "next/server";
import { PEOPLE_TEMPLATES } from "@/lib/prompts/role-templates";
import { DIMENSIONS } from "@/lib/prompts/dimensions";
import { TOPIC_POOL } from "@/lib/prompts/topics";
import { MODE_OPTIONS } from "@/lib/scheduler/modes";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    people: PEOPLE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      initials: t.initials,
      color: t.color,
    })),
    dimensions: DIMENSIONS,
    topics: TOPIC_POOL,
    modes: MODE_OPTIONS,
  });
}

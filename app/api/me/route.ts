import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureUser, listSessionsForUser, getSessionRolesAndTopic, getSummary } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";

export const runtime = "nodejs";

const Body = z.object({
  browserToken: z.string().min(8),
  nickname: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
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
  const sessions = await listSessionsForUser(user.id);
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const { roles: roleConfigs, topic } = getSessionRolesAndTopic(s);
      let names: string[] = [];
      try {
        names = resolveRoles(roleConfigs).map((r) => r.name);
      } catch {
        names = [];
      }
      const sum = await getSummary(s.id);
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        topic,
        roleNames: names,
        summary: sum ? JSON.parse(sum.payloadJson) : null,
      };
    }),
  );
  return NextResponse.json({ user: { id: user.id, nickname: user.nickname }, sessions: enriched });
}

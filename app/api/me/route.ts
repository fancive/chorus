import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureUser, listSessionsForUser, getSummary } from "@/lib/db/repo";

export const runtime = "nodejs";

const Body = z.object({
  browserToken: z.string().min(8),
  nickname: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = Body.parse(await req.json());
  const user = await ensureUser({
    browserToken: body.browserToken,
    nickname: body.nickname,
  });
  const sessions = listSessionsForUser(user.id);
  const enriched = sessions.map((s) => ({
    id: s.id,
    mode: s.mode,
    status: s.status,
    createdAt: s.createdAt,
    endedAt: s.endedAt,
    summary: (() => {
      const sum = getSummary(s.id);
      return sum ? JSON.parse(sum.payloadJson) : null;
    })(),
  }));
  return NextResponse.json({ user: { id: user.id, nickname: user.nickname }, sessions: enriched });
}

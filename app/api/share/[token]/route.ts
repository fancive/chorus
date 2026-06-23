import { NextRequest, NextResponse } from "next/server";
import {
  getSessionByShareToken,
  getSessionRolesAndTopic,
  getSummary,
  listMessages,
} from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";
import { safeParseSummary } from "@/lib/prompts/host-summary";
import { withRequestLog } from "@/lib/server/logger";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export const GET = withRequestLog(
  "GET /api/share/[token]",
  async (
    req: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    // Unauthenticated public read — rate-limit per IP so a script can't hammer
    // the DB or scan tokens at full speed.
    const rl = rateLimit(`share:${clientIp(req)}`, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
            "X-Robots-Tag": "noindex, nofollow",
          },
        },
      );
    }
    const { token } = await params;
    const session = await getSessionByShareToken(token);
    if (!session) {
      return NextResponse.json(
        { error: "share_not_found" },
        { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } },
      );
    }
    const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
    const roles = resolveRoles(roleConfigs);
    const [messages, summary] = await Promise.all([
      listMessages(session.id),
      getSummary(session.id),
    ]);
    return NextResponse.json(
      {
        session: {
          title: session.title,
          topic,
          roles: roles.map((r) => ({ name: r.name, initials: r.initials, color: r.color })),
          createdAt: session.createdAt,
          endedAt: session.endedAt,
        },
        summary: summary ? safeParseSummary(summary.payloadJson) : null,
        messages: messages
          .filter((m) => m.content.trim())
          .map((m) => ({
            actor: m.actor,
            actorRoleIndex: m.actorRoleIndex,
            content: m.content,
            status: m.status,
            seq: m.seq,
          })),
      },
      { headers: { "X-Robots-Tag": "noindex, nofollow" } },
    );
  },
);

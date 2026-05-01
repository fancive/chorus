import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getOwnedSession, setShareToken } from "@/lib/db/repo";
import { extractBrowserToken } from "@/lib/server/auth";
import { withRequestLog } from "@/lib/server/logger";

export const runtime = "nodejs";

export const POST = withRequestLog(
  "POST /api/room/[id]/share",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await getOwnedSession(id, extractBrowserToken(req));
    if (!session) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    const token = session.shareToken ?? nanoid(16);
    if (!session.shareToken) await setShareToken(id, token);
    return NextResponse.json({ token });
  },
);

export const DELETE = withRequestLog(
  "DELETE /api/room/[id]/share",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await getOwnedSession(id, extractBrowserToken(req));
    if (!session) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    await setShareToken(id, null);
    return NextResponse.json({ ok: true });
  },
);

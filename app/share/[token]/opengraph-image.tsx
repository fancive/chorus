import { ImageResponse } from "next/og";
import { getSessionByShareToken, getSessionRolesAndTopic } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Chorus 对话场";

export default async function OgImage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const session = await getSessionByShareToken(token);
  let topic = "Chorus 对话场";
  let roleNames = "";
  let title: string | null = null;
  if (session) {
    const { roles: roleConfigs, topic: t } = getSessionRolesAndTopic(session);
    const roles = resolveRoles(roleConfigs);
    topic = t || roles.map((r) => r.name).join(" / ");
    roleNames = roles.map((r) => r.name).join("  ·  ");
    title = session.title;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 80,
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#f8fafc",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ fontSize: 28, color: "#94a3b8", letterSpacing: "0.18em" }}>
          CHORUS · 对话场
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
          }}
        >
          {title && (
            <div style={{ fontSize: 36, color: "#cbd5e1", marginBottom: 16 }}>
              {title}
            </div>
          )}
          <div
            style={{
              fontSize: 72,
              fontWeight: 600,
              lineHeight: 1.15,
              maxWidth: 1040,
            }}
          >
            {topic}
          </div>
          {roleNames && (
            <div style={{ display: "flex", marginTop: 40, fontSize: 32, color: "#60a5fa" }}>
              {roleNames}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 22 }}>
          <span>一场由主持人控场的多角色 AI 对话</span>
          <span>chorus</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

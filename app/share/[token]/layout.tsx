import type { Metadata } from "next";
import { getSessionByShareToken, getSessionRolesAndTopic } from "@/lib/db/repo";
import { resolveRoles } from "@/lib/prompts/role-builder";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const session = await getSessionByShareToken(token);
  if (!session) {
    return {
      title: "Chorus · 分享链接无效",
      robots: { index: false, follow: false },
    };
  }
  const { roles: roleConfigs, topic } = getSessionRolesAndTopic(session);
  const roles = resolveRoles(roleConfigs);
  const title =
    session.title?.trim() || topic || roles.map((r) => r.name).join(" / ");
  const description = `${roles.map((r) => r.name).join(" · ")} · 一场由主持人控场的多角色 AI 对话`;
  // The colocated opengraph-image.tsx provides og:image automatically.
  return {
    title: `${title} · Chorus`,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function ShareTokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

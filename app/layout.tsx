import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chorus / 对话场",
  description: "一个由主持人控场的多角色 AI 对话空间",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}

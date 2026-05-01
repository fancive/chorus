import type { Metadata } from "next";

// Share links are opt-in URLs; explicitly tell crawlers not to index them
// or follow into the rest of the app.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoolSense Circuit Twin — SUSS Energy Intelligence",
  description: "A circuit-level digital twin that turns SUSS energy data into practical, comfort-safe retrofit decisions.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "大老二",
  description: "Big Two card game for 4 players",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "大老二",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}

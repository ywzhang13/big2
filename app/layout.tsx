import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "阿瑋娛樂城",
  description: "多人線上娛樂遊戲 — 大老二、台灣麻將",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "阿瑋娛樂城",
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}

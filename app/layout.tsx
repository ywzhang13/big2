import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FxBgWarmRoot } from "@/components/mahjong/FxBgWarmRoot";

export const metadata: Metadata = {
  title: "阿瑋娛樂城",
  description: "多人線上娛樂遊戲 — 大老二、台灣麻將",
  // 全站「加到主畫面」：圖示和名稱用麻將那張封面；/mahjong 的 layout 會用自己的 manifest 蓋掉這組
  manifest: "/app.webmanifest",
  icons: {
    apple: "/mahjong-app/apple-touch-icon.png",
  },
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
      <body className="min-h-dvh flex flex-col">{children}<FxBgWarmRoot /></body>
    </html>
  );
}

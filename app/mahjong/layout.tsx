import type { Metadata, Viewport } from "next";
import { preload } from "react-dom";

// 台灣麻將「加到主畫面」：manifest、iPhone 主畫面名稱和圖示、主題色只掛在 /mahjong，首頁和大老二照舊
export const metadata: Metadata = {
  manifest: "/mahjong.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "阿瑋娛樂城",
  },
  icons: {
    apple: "/mahjong-app/apple-touch-icon.png",
  },
};

// 主題色＝牌桌的深綠，從主畫面打開時狀態列和啟動畫面不會閃白
export const viewport: Viewport = {
  themeColor: "#0f2a1a",
};

export default function MahjongLayout({ children }: { children: React.ReactNode }) {
  // 大廳 Logo 的明體子集（2.6KB）只在麻將頁預載，標題第一次畫出來就是明體
  preload("/fonts/noto-serif-tc/brand-900.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return children;
}

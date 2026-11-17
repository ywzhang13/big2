import { preload } from "react-dom";

export default function ThirteenLayout({ children }: { children: React.ReactNode }) {
  // 大廳標題「十三支」的明體子集（1KB）只在十三支頁預載，標題第一次畫出來就是明體（同麻將 app/mahjong/layout.tsx）
  preload("/fonts/noto-serif-tc/brand-th-900.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return children;
}

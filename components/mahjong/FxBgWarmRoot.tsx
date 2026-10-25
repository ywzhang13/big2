"use client";
// 根 layout 用（app/layout.tsx）：只在網站首頁和麻將頁才動態載入特效背景預熱（components/mahjong/FxBgWarm.tsx，
// 連同大牌特效、隕石的程式和樣式）。這個檔案本身很小、不 import 任何特效，所以大老二頁不會下載特效的 JS 和 CSS（審伯 2026-10-25）
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";

const FxBgWarm = dynamic(() => import("./FxBgWarm").then((m) => m.FxBgWarm), { ssr: false });

export function FxBgWarmRoot() {
  const path = usePathname();
  // 手機（觸控）＝手機版版面；只決定預熱時畫哪一種尺寸，開網頁時判斷一次
  const [mobile] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  return path === "/" || path === "/mahjong" ? <FxBgWarm mobile={mobile} /> : null;
}

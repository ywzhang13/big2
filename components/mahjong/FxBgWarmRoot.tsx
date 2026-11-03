"use client";
// 根 layout 用（app/layout.tsx）：只在網站首頁和麻將頁才動態載入特效背景預熱（components/mahjong/FxBgWarm.tsx，
// 連同大牌特效、隕石的程式和樣式）。這個檔案本身很小、不 import 任何特效，所以大老二頁不會下載特效的 JS 和 CSS（審伯 2026-10-25）
// 觸控裝置不預熱（老闆 2026-11-04 回報 iPhone 閃退）：預熱把每種特效同時掛兩份，圖層尖峰比真的播放還高（手機估算 445MB），
// 而且開網頁就在大廳跑。手機改成第一次播放稍微卡一點，換不崩潰。
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";

const FxBgWarm = dynamic(() => import("./FxBgWarm").then((m) => m.FxBgWarm), { ssr: false });

export function FxBgWarmRoot() {
  const path = usePathname();
  // 開網頁時判斷一次：手機（觸控）不預熱
  const [touch] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  return !touch && (path === "/" || path === "/mahjong") ? <FxBgWarm mobile={false} /> : null;
}

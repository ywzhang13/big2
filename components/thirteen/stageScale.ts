"use client";
// 十三支版面縮放（小宜 v8-A §1）：以手機 844×390 為基準，整塊等比放大（或縮小）、放在畫面正中央，多出來的地方只有桌布。
//   --th-s：牌桌、亮牌（上限 3.2 倍）；--th-s2：理牌、結算、設定（上限 2.4 倍，再大牌圖會糊）。掛在 <html> 上，CSS 用 var() 乘
import { useEffect } from "react";

export const BASE_W = 844, BASE_H = 390, CAP_TABLE = 3.2, CAP_PANEL = 2.4;
export function stageScales(w: number, h: number): { table: number; panel: number } {
  const fit = Math.min(w / BASE_W, h / BASE_H);
  return { table: Math.min(fit, CAP_TABLE), panel: Math.min(fit, CAP_PANEL) };
}
/** 現在的牌桌倍數（特效尺寸要跟著乘） */
export const stageScale = (): number => {
  if (typeof document === "undefined") return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--th-s"));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

export function useStageScale(): void {
  useEffect(() => {
    const apply = () => {
      const { table, panel } = stageScales(window.innerWidth, window.innerHeight);
      document.documentElement.style.setProperty("--th-s", table.toFixed(4));
      document.documentElement.style.setProperty("--th-s2", panel.toFixed(4));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
}

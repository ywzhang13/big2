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

// 打字中換畫面（阿妍 2026-11-27）：iPhone 鍵盤開著時 innerHeight 只剩鍵盤上面一小塊（932×430 橫拿剩 176），這時換畫面重算會變 0.45 倍；
//   鍵盤收起時 iPhone 不送 window 的 resize，所以一直縮著。改成：
//   ・輸入框有焦點、寬度沒變、高度卻變矮＝鍵盤開著：沿用上一次的高度，不縮（記在模組裡，換畫面重新掛上也記得）
//   ・另外聽 visualViewport 的 resize（iPhone 收鍵盤會送）、focusout（收鍵盤）、orientationchange、pageshow（從背景回來），都重算一次
//   ・換畫面時輸入框常常已經被拆掉（焦點回到 body）、鍵盤卻還在收：寬度沒變、高度變矮又不在打字時，接下來 10 秒每 250ms 看一次，
//     高度一回來就重算（有些 WebView 收鍵盤什麼事件都不送）
let lastW = 0, lastH = 0;
const editing = (doc: Document): boolean => {
  const a = doc.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
};
/** 算倍數用的畫面大小：打字中（鍵盤開著）高度變矮時沿用上一次的高度 */
export function stageViewport(w: number, h: number, typing: boolean, last: { w: number; h: number }): { w: number; h: number } {
  return typing && w === last.w && h < last.h ? { w, h: last.h } : { w, h };
}

type Win = Pick<Window, "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener"> & { visualViewport?: Pick<VisualViewport, "addEventListener" | "removeEventListener"> | null };
/** 算一次倍數並掛上監聽；回傳拆監聽的函式（useStageScale 用；測試直接帶假的 window／document） */
export const RECHECK_MS = 250, RECHECK_TIMES = 40;
export function attachStageScale(win: Win, doc: Document): () => void {
  let poll: ReturnType<typeof setInterval> | null = null;
  const stopPoll = () => { if (poll != null) { clearInterval(poll); poll = null; } };
  /** 高度變矮、不在打字：等它長回 target 就重算（最多 RECHECK_TIMES 次） */
  const watch = (target: number) => {
    stopPoll();
    let n = 0;
    poll = setInterval(() => {
      n++;
      if (win.innerHeight !== lastH) apply();
      if (win.innerHeight >= target || n >= RECHECK_TIMES) stopPoll();
    }, RECHECK_MS);
  };
  const apply = () => {
    const w = win.innerWidth, h = win.innerHeight, typing = editing(doc);
    const v = stageViewport(w, h, typing, { w: lastW, h: lastH });
    if (!typing && w === lastW && h < lastH && poll == null) watch(lastH);
    lastW = v.w; lastH = v.h;
    const { table, panel } = stageScales(v.w, v.h);
    doc.documentElement.style.setProperty("--th-s", table.toFixed(4));
    doc.documentElement.style.setProperty("--th-s2", panel.toFixed(4));
  };
  // focusout 時焦點還在輸入框上（activeElement 還沒換），等這一輪事件結束再算
  const later = () => { setTimeout(apply, 0); };
  apply();
  const vv = win.visualViewport;
  win.addEventListener("resize", apply);
  win.addEventListener("orientationchange", apply);
  win.addEventListener("pageshow", apply);
  win.addEventListener("focusout", later);
  vv?.addEventListener("resize", apply);
  return () => {
    stopPoll();
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", apply);
    win.removeEventListener("pageshow", apply);
    win.removeEventListener("focusout", later);
    vv?.removeEventListener("resize", apply);
  };
}

export function useStageScale(): void {
  useEffect(() => attachStageScale(window, document), []);
}

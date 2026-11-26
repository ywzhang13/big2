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
//   ・換畫面時輸入框常常已經被拆掉（焦點回到 body）、鍵盤卻還在收：寬度沒變、高度變矮又不在打字時，記下「該回到的高度」，
//     接下來每 250ms 看一次（最多 40 次），高度一回來就重算（有些 WebView 收鍵盤什麼事件都不送）
//   ・審伯 R1：「該回到的高度」和輪詢都記在模組裡（換畫面時舊畫面卸載、新畫面掛上，接著等，不會因為新畫面掛上時高度已經是矮的就忘了）；
//     所有畫面都卸載才停輪詢，40 次是一次等待的上限（中途換畫面不重算）；
//     另外記「這個寬度、不在打字時看過最高的高度」：新畫面掛上時如果比它矮（例如上一次等到放棄、鍵盤其實還開著），重新等一輪（一樣最多 40 次）
//   ・審伯 R2：focusout 排的延後重算記在這個畫面上，卸載時一起取消（卸載後不寫樣式、不開輪詢）
let lastW = 0, lastH = 0;
/** 這個寬度、不在打字時看過最高的高度（寬度變了就重記） */
let fullW = 0, fullH = 0;
/** 不在打字時高度變矮：等它回到這個高度（同一個寬度）；checks＝已經看了幾次 */
let recover: { w: number; h: number; checks: number } | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
/** 目前掛著的畫面（最後掛上的那個負責輪詢時重算） */
const owners: { apply: () => void }[] = [];
const editing = (doc: Document): boolean => {
  const a = doc.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
};
/** 算倍數用的畫面大小：打字中（鍵盤開著）高度變矮時沿用上一次的高度 */
export function stageViewport(w: number, h: number, typing: boolean, last: { w: number; h: number }): { w: number; h: number } {
  return typing && w === last.w && h < last.h ? { w, h: last.h } : { w, h };
}

type Win = Pick<Window, "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener"> & { visualViewport?: Pick<VisualViewport, "addEventListener" | "removeEventListener"> | null };
export const RECHECK_MS = 250, RECHECK_TIMES = 40;
const stopPoll = () => { if (poll != null) { clearInterval(poll); poll = null; } };
/** 有「該回到的高度」、而且有畫面掛著：開始（或繼續）每 RECHECK_MS 看一次 */
function ensurePoll(): void {
  if (poll != null || !recover || !owners.length) return;
  poll = setInterval(() => {
    const owner = owners[owners.length - 1];
    if (!recover || !owner) { stopPoll(); return; }
    recover.checks++;
    owner.apply(); // 高度回來了會清掉 recover
    if (recover && recover.checks >= RECHECK_TIMES) recover = null; // 等太久：放棄，不再等
    if (!recover) stopPoll();
  }, RECHECK_MS);
}

/** 算一次倍數並掛上監聽；回傳拆監聽的函式（useStageScale 用；測試直接帶假的 window／document） */
export function attachStageScale(win: Win, doc: Document): () => void {
  let alive = true;
  const apply = (mounting = false) => {
    if (!alive) return;
    const w = win.innerWidth, h = win.innerHeight, typing = editing(doc);
    const v = stageViewport(w, h, typing, { w: lastW, h: lastH });
    if (!typing && w !== fullW) { fullW = w; fullH = h; } else if (!typing && h > fullH) fullH = h;
    if (!typing && !recover && w === fullW && h < fullH && (h < lastH || mounting)) recover = { w, h: fullH, checks: 0 };
    if (recover && (w !== recover.w || h >= recover.h)) recover = null; // 回來了，或寬度變了（轉向）：不用再等
    lastW = v.w; lastH = v.h;
    const { table, panel } = stageScales(v.w, v.h);
    doc.documentElement.style.setProperty("--th-s", table.toFixed(4));
    doc.documentElement.style.setProperty("--th-s2", panel.toFixed(4));
    if (recover) ensurePoll(); else stopPoll();
  };
  const owner = { apply: () => apply() };
  owners.push(owner);
  // focusout 時焦點還在輸入框上（activeElement 還沒換），等這一輪事件結束再算；排了哪些記下來，卸載時取消
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const later = () => { const id = setTimeout(() => { pending.delete(id); apply(); }, 0); pending.add(id); };
  apply(true);
  const onEvent = () => apply();
  const vv = win.visualViewport;
  win.addEventListener("resize", onEvent);
  win.addEventListener("orientationchange", onEvent);
  win.addEventListener("pageshow", onEvent);
  win.addEventListener("focusout", later);
  vv?.addEventListener("resize", onEvent);
  return () => {
    alive = false;
    pending.forEach((id) => clearTimeout(id)); pending.clear();
    const i = owners.indexOf(owner);
    if (i >= 0) owners.splice(i, 1);
    if (!owners.length) stopPoll(); // 還有別的畫面掛著就讓它接著等；recover 留著，下一個畫面掛上時接著等
    win.removeEventListener("resize", onEvent);
    win.removeEventListener("orientationchange", onEvent);
    win.removeEventListener("pageshow", onEvent);
    win.removeEventListener("focusout", later);
    vv?.removeEventListener("resize", onEvent);
  };
}

export function useStageScale(): void {
  useEffect(() => attachStageScale(window, document), []);
}

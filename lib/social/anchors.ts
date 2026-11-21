// 三款共用的浮層定位小工具（小宜〈十三支共用聊天互動 v1〉§6：從麻將 MjChat 的 rectOf／setPos 抽出來）。
// 浮層（聊天鈕、泡泡、聊天室、道具選單、提示）一律 position: fixed、用螢幕像素，位置每次量 DOM 決定，直接寫到元素上（不經過 React state）。

export type Box = { left: number; top: number; right: number; bottom: number };
export type Pos = { left?: number; right?: number; top?: number; bottom?: number };

/** 量一個元素（量不到、寬是 0 回 null） */
export const rectOf = (sel: string): Box | null => {
  if (typeof document === "undefined") return null;
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return r && r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/** 位置寫到元素上；null＝量不到，先藏起來 */
export function setPos(el: HTMLElement | null, p: Pos | null): void {
  if (!el) return;
  el.style.visibility = p ? "" : "hidden";
  if (!p) return;
  for (const k of ["left", "right", "top", "bottom"] as const) el.style[k] = p[k] == null ? "" : `${Math.round(p[k]!)}px`;
}

/** 兩個框重疊的面積（驗收量測、選單避讓用） */
export const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** 桌機：寬 ≥ 1100 且高 ≥ 700（和麻將 desk 同一條件） */
export const isDesk = (w: number, h: number): boolean => w >= 1100 && h >= 700;

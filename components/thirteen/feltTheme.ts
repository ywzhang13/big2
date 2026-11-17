// 十三支簡約牌桌四款（小宜 v7 §1）：只影響自己的畫面，記在本機；掛在 <html data-th-felt>，顏色在 thRoom.css
export const FELTS = [
  { key: "green", name: "深綠絨布", swatch: "#1F6B45" },
  { key: "blue", name: "午夜藍", swatch: "#24507F" },
  { key: "wine", name: "酒紅", swatch: "#7A2A3A" },
  { key: "gray", name: "石墨灰", swatch: "#4A4E55" },
] as const;
export type FeltKey = (typeof FELTS)[number]["key"];
const KEY = "th_felt";
export const isFelt = (v: unknown): v is FeltKey => FELTS.some((f) => f.key === v);

export function loadFelt(): FeltKey {
  try { const v = localStorage.getItem(KEY); return isFelt(v) ? v : "green"; } catch { return "green"; }
}
export function applyFelt(k: FeltKey, save = true): void {
  if (k === "green") delete document.documentElement.dataset.thFelt; else document.documentElement.dataset.thFelt = k;
  if (save) try { localStorage.setItem(KEY, k); } catch { /* 存不了就只是下次回預設 */ }
}

// 十三支桌布四款：四神獸（老闆 2026-11-26 定案，取代小宜 v7 簡約四款；v2 圖照小宜禁區圖重生）。他家的牌背跟著桌布換（cardArt.ts setBackFelt）。只影響自己的畫面，記在本機；掛在 <html data-th-felt>，圖和底色在 thRoom.css。
// key 沿用舊的四款（green／blue／wine／gray），玩家原本選的款式直接對到新的神獸，不用重選
import { whenScreenImagesLoaded } from "@/lib/perf/tableFirst";
import { setBackFelt } from "./cardArt";

export const FELTS = [
  { key: "green", name: "青龍", swatch: "#3BAD5C" },
  { key: "wine", name: "朱雀", swatch: "#D5262D" },
  { key: "gray", name: "白虎", swatch: "#646464" },
  { key: "blue", name: "玄武", swatch: "#1980A0" },
] as const;
export type FeltKey = (typeof FELTS)[number]["key"];
const KEY = "th_felt";
export const isFelt = (v: unknown): v is FeltKey => FELTS.some((f) => f.key === v);

export function loadFelt(): FeltKey {
  try { const v = localStorage.getItem(KEY); return isFelt(v) ? v : "green"; } catch { return "green"; }
}

let imgScheduled = false;
let imgShown = false;
let current: FeltKey = "green";
/** 桌布圖在牌面之後才載入（第一把不卡）：等畫面上的牌面圖都載好（最多 8 秒）才在 <html> 加 data-th-felt-img，thRoom.css 這時才套用圖 */
function showFeltImageLater(): void {
  if (imgScheduled) return;
  imgScheduled = true;
  void whenScreenImagesLoaded().then(() => {
    imgShown = true;
    document.documentElement.dataset.thFeltImg = "1";
    setBackFelt(current); // 牌背也在這時才換成神獸牌背（之前用原本的牌背頂著）
  });
}

export function applyFelt(k: FeltKey, save = true): void {
  if (k === "green") delete document.documentElement.dataset.thFelt; else document.documentElement.dataset.thFelt = k;
  current = k;
  if (imgShown) setBackFelt(k); // 牌面已經載過：切換桌布時牌背立刻跟著換（新牌背載好才換，不會空白）
  showFeltImageLater();
  if (save) try { localStorage.setItem(KEY, k); } catch { /* 存不了就只是下次回預設 */ }
}

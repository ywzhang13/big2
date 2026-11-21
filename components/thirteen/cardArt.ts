// 十三支牌面圖：v4＝純白底（老闆 2026-11-19；A～10 從 v2、J／Q／K 從 v3 用同一支程式重產，只把底版米白換成白，其他不變），牌背 v2。
// 放在 public/tiles/thirteen/（tiles 是長期快取目錄，換圖一律換檔名，見 lib/staticCache.ts）。
// 兩副黑桃（id 結尾 1／2）共用同一張圖。
import { buildDeck, type Card } from "@/lib/thirteen";
import { warmImages } from "@/lib/perf/tableFirst";

const SUIT_NAME = { S: "spade", H: "heart", D: "diamond", C: "club" } as const;
const DIR = "/tiles/thirteen";

// 手機用 240 寬的小圖（.m.webp，老馬 2026-11-21）：手機上一張牌最大只畫到 61 個點（3 倍螢幕＝183 像素），
// 原圖 500×700 一張 18～90KB，16 張手牌在 4G 下要 2～3.5 秒才一張張出來；小圖一整副（含牌背）584KB、原圖 1.76MB。
// 桌機（同 ThRevealFx 的 DESKTOP）照舊用原圖。只在瀏覽器判斷：牌只在登入後才畫，伺服器輸出的頁面裡沒有牌圖
const DESKTOP = "(min-width: 1100px) and (min-height: 700px)";
const desktopMq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP) : null;
const sz = () => (desktopMq && !desktopMq.matches ? ".m" : "");

/** lucky＝這一局彩金牌的點數：點數一樣的牌用金卡圖（小宜 v15 §1：整張變金，不是疊框；金卡 v1 由 v4 白底照 §8 算出來） */
export function cardSrc(card: Card, lucky: number | null = null): string {
  const face = card.rank === 14 ? "a" : card.rank === 13 ? "k" : card.rank === 12 ? "q" : card.rank === 11 ? "j" : String(card.rank);
  return `${DIR}/card-front-${SUIT_NAME[card.suit]}-${face}.${isGold(card, lucky) ? "gold.v1" : "v4"}${sz()}.webp`;
}
export const isGold = (card: Card, lucky: number | null) => lucky !== null && card.rank === lucky;

const backSrc = () => `${DIR}/card-back.v2${sz()}.webp`;
/** 牌背：export let＝即時綁定，跨過桌機斷點時下面會換成目前尺寸（審伯 R1：原本在載入時就固定，手機開頁再放大到桌機，牌背還是小圖） */
export let CARD_BACK_SRC = backSrc();

/** 一整副牌面（不含金卡）＋牌背：進十三支大廳就先在背景載（lib/perf/tableFirst.ts），開局時手牌不用再下載 */
export const deckSrcs = (deck: readonly Card[]): string[] => [...deck.map((c) => cardSrc(c)), CARD_BACK_SRC];

// 跨過桌機斷點（審伯〈第一把效能改善-初審〉R1）：同一頁不重新整理，
//   ・牌背換成目前尺寸；之後畫的牌面、金卡由 cardSrc 每次讀目前尺寸
//   ・畫面上已經畫好的十三支牌圖（牌面、金卡、牌背）直接換網址，不等下一個遊戲事件才重畫；React 之後重畫給的也是同一個網址
//   ・用目前尺寸重新背景預載整副（預載來源和畫面一致；金卡等知道彩金點數時由頁面照常預載）
const CARD_IMG = /^(.*\/tiles\/thirteen\/card-(?:front-[a-z]+-[0-9akqj]+\.(?:v4|gold\.v1)|back\.v2))(?:\.m)?\.webp$/;
/** 十三支牌圖網址換成指定尺寸（不是牌圖就原樣回傳） */
export function sizedCardUrl(url: string, desktop: boolean): string {
  const m = CARD_IMG.exec(url);
  return m ? `${m[1]}${desktop ? "" : ".m"}.webp` : url;
}
function onSizeChange() {
  const desktop = !!desktopMq?.matches;
  CARD_BACK_SRC = backSrc();
  if (typeof document === "undefined") return;
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/tiles/thirteen/card-"]'))) {
    const cur = img.getAttribute("src") ?? "";
    const next = sizedCardUrl(cur, desktop);
    if (next !== cur) img.setAttribute("src", next);
  }
  if (typeof Image === "function") warmImages(deckSrcs(buildDeck()));
}
if (desktopMq) {
  if (typeof desktopMq.addEventListener === "function") desktopMq.addEventListener("change", onSizeChange);
  else desktopMq.addListener?.(onSizeChange); // 舊版 Safari
}

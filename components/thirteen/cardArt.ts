// 十三支牌面圖：v4＝純白底（老闆 2026-11-19；A～10 從 v2、J／Q／K 從 v3 用同一支程式重產，只把底版米白換成白，其他不變），牌背 v2。
// J／Q／K v5／gold.v2＝加角落雲紋竹葉（小宜 2026-11-26 乙案，從黑桃 A 取出、縮 60%；老闆：風格統一），A～10 照舊 v4／gold.v1。
// 放在 public/tiles/thirteen/（tiles 是長期快取目錄，換圖一律換檔名，見 lib/staticCache.ts）。
// 兩副黑桃（id 結尾 1／2）共用同一張圖。
import { buildDeck, type Card } from "@/lib/thirteen";
import { warmImages } from "@/lib/perf/tableFirst";
import type { FeltKey } from "./feltTheme";

const SUIT_NAME = { S: "spade", H: "heart", D: "diamond", C: "club" } as const;
const DIR = "/tiles/thirteen";

// 手機用 240 寬的小圖（.m.webp，老馬 2026-11-21）：手機上一張牌最大只畫到 61 個點（3 倍螢幕＝183 像素），
// 原圖 500×700 一張 18～90KB，16 張手牌在 4G 下要 2～3.5 秒才一張張出來；小圖一整副（含牌背）584KB、原圖 1.76MB。
// 桌機（同 ThRevealFx 的 DESKTOP）照舊用原圖。只在瀏覽器判斷：牌只在登入後才畫，伺服器輸出的頁面裡沒有牌圖
const DESKTOP = "(min-width: 1100px) and (min-height: 700px)";
const desktopMq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP) : null;
const sz = () => (desktopMq && !desktopMq.matches ? ".m" : "");

/** lucky＝這一局彩金牌的點數：點數一樣的牌用金卡圖（小宜 v15 §1：整張變金，不是疊框；金卡 v1 由 v4 白底照 §8 算出來）。
 *  J／Q／K 用加角落裝飾的 v5／gold.v2（小宜 2026-11-26） */
export function cardSrc(card: Card, lucky: number | null = null): string {
  const face = card.rank === 14 ? "a" : card.rank === 13 ? "k" : card.rank === 12 ? "q" : card.rank === 11 ? "j" : String(card.rank);
  const faceCard = card.rank >= 11 && card.rank <= 13;
  const ver = isGold(card, lucky) ? (faceCard ? "gold.v2" : "gold.v1") : (faceCard ? "v5" : "v4");
  return `${DIR}/card-front-${SUIT_NAME[card.suit]}-${face}.${ver}${sz()}.webp`;
}
export const isGold = (card: Card, lucky: number | null) => lucky !== null && card.rank === lucky;

// 牌背跟著桌布換（老闆 2026-11-26 四神獸）：青龍綠、朱雀紅、白虎灰、玄武藍，各一張 v1（500×700＋手機 240×336 .m）。
// 開頁先用原本的 card-back.v2 頂著（第一把不多載）；等牌面載完（feltTheme.ts 掛桌布圖那一刻）才換成神獸牌背：
// 新圖先在背景載好才換網址，畫面上的牌背不會有空白一下
const BEAST_BACK: Record<FeltKey, string> = { green: "dragon", wine: "phoenix", gray: "tiger", blue: "tortoise" };
let backFelt: FeltKey | null = null; // null＝還沒換（用原本的牌背）
const beastBack = (k: FeltKey) => `${DIR}/card-back-${BEAST_BACK[k]}.v1${sz()}.webp`;
const backSrc = () => (backFelt ? beastBack(backFelt) : `${DIR}/card-back.v2${sz()}.webp`);
/** 牌背：export let＝即時綁定，跨過桌機斷點時下面會換成目前尺寸（審伯 R1：原本在載入時就固定，手機開頁再放大到桌機，牌背還是小圖） */
export let CARD_BACK_SRC = backSrc();

/** 一整副牌面（不含金卡）＋牌背：進十三支大廳就先在背景載（lib/perf/tableFirst.ts），開局時手牌不用再下載 */
export const deckSrcs = (deck: readonly Card[]): string[] => [...deck.map((c) => cardSrc(c)), CARD_BACK_SRC];

// 跨過桌機斷點（審伯〈第一把效能改善-初審〉R1）：同一頁不重新整理，
//   ・牌背換成目前尺寸；之後畫的牌面、金卡由 cardSrc 每次讀目前尺寸
//   ・畫面上已經畫好的十三支牌圖（牌面、金卡、牌背）直接換網址，不等下一個遊戲事件才重畫；React 之後重畫給的也是同一個網址
//   ・用目前尺寸重新背景預載整副（預載來源和畫面一致；金卡等知道彩金點數時由頁面照常預載）
const CARD_IMG = /^(.*\/tiles\/thirteen\/card-(?:front-[a-z]+-[0-9akqj]+\.(?:v4|v5|gold\.v1|gold\.v2)|back\.v2|back-[a-z]+\.v1))(?:\.m)?\.webp$/; // v5／gold.v2＝J／Q／K 加角落裝飾；back-*.v1＝神獸牌背
/** 十三支牌圖網址換成指定尺寸（不是牌圖就原樣回傳） */
export function sizedCardUrl(url: string, desktop: boolean): string {
  const m = CARD_IMG.exec(url);
  return m ? `${m[1]}${desktop ? "" : ".m"}.webp` : url;
}
function onSizeChange() {
  const desktop = !!desktopMq?.matches;
  // 神獸牌背（審伯〈亮版浮雕v4與牌背-初審〉R2）：新尺寸的圖先在背景載好才換，載好前畫面維持原本那張；原本的 card-back.v2 照舊直接換
  const beast = backFelt !== null;
  if (beast) loadBack(wantBack ?? backFelt!); else CARD_BACK_SRC = backSrc();
  if (typeof document === "undefined") return;
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(beast ? 'img[src*="/tiles/thirteen/card-front"]' : 'img[src*="/tiles/thirteen/card-"]'))) {
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

/** 畫面上已經畫好的牌背全部換成目前的牌背網址（React 之後重畫讀 CARD_BACK_SRC，也是同一個） */
function swapBacks() {
  if (typeof document === "undefined") return;
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/tiles/thirteen/card-back"]'))) {
    if (img.getAttribute("src") !== CARD_BACK_SRC) img.setAttribute("src", CARD_BACK_SRC);
  }
}
let wantBack: FeltKey | null = null;
let backReq = 0; // 每次發新的牌背下載就 +1；舊的回呼看到編號不同就不動作
/** 在背景載這款神獸牌背（目前尺寸），載好才換成「載好的那個網址」（審伯 R2）：
 *  ・載好時尺寸已變（跨過桌機斷點）→ 改載目前尺寸，載好再換，不會換上還沒載好的圖
 *  ・載失敗 → 維持現在的牌背
 *  ・之後又切換款式或尺寸 → 這次的回呼作廢，只採用最後一次 */
function loadBack(k: FeltKey): void {
  const url = beastBack(k);
  const id = ++backReq;
  const done = () => {
    if (id !== backReq) return;
    if (url !== beastBack(k)) { loadBack(k); return; }
    backFelt = k;
    CARD_BACK_SRC = url;
    swapBacks();
  };
  if (typeof Image !== "function") { done(); return; }
  const img = new Image();
  img.onload = done;
  img.src = url;
}
/** 牌背換成這款桌布的神獸牌背：先在背景載好新圖，載好才換（載失敗就維持現在的牌背）；連續切換只採用最後一次 */
export function setBackFelt(k: FeltKey): void {
  wantBack = k;
  if (backFelt === k && CARD_BACK_SRC === beastBack(k)) { backReq++; return; } // 已經是這款、尺寸也對：取消還在載的其他款
  loadBack(k);
}
/** 測試用 */
export const __backFelt = () => backFelt;

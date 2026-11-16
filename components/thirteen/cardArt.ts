// 十三支牌面圖：A～10 用 v2、J／Q／K 用 v3（老馬 2026-11-16），牌背 v2。
// 放在 public/tiles/thirteen/（tiles 是長期快取目錄，換圖一律換檔名，見 lib/staticCache.ts）。
// 兩副黑桃（id 結尾 1／2）共用同一張圖。
import type { Card } from "@/lib/thirteen";

const SUIT_NAME = { S: "spade", H: "heart", D: "diamond", C: "club" } as const;
const DIR = "/tiles/thirteen";

export function cardSrc(card: Card): string {
  const face = card.rank === 14 ? "a" : card.rank === 13 ? "k" : card.rank === 12 ? "q" : card.rank === 11 ? "j" : String(card.rank);
  const ver = card.rank >= 11 && card.rank <= 13 ? "v3" : "v2";
  return `${DIR}/card-front-${SUIT_NAME[card.suit]}-${face}.${ver}.webp`;
}

export const CARD_BACK_SRC = `${DIR}/card-back.v2.webp`;

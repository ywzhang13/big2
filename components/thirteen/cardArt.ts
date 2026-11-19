// 十三支牌面圖：v4＝純白底（老闆 2026-11-19；A～10 從 v2、J／Q／K 從 v3 用同一支程式重產，只把底版米白換成白，其他不變），牌背 v2。
// 放在 public/tiles/thirteen/（tiles 是長期快取目錄，換圖一律換檔名，見 lib/staticCache.ts）。
// 兩副黑桃（id 結尾 1／2）共用同一張圖。
import type { Card } from "@/lib/thirteen";

const SUIT_NAME = { S: "spade", H: "heart", D: "diamond", C: "club" } as const;
const DIR = "/tiles/thirteen";

/** lucky＝這一局彩金牌的點數：點數一樣的牌用金卡圖（小宜 v15 §1：整張變金，不是疊框；金卡 v1 由 v4 白底照 §8 算出來） */
export function cardSrc(card: Card, lucky: number | null = null): string {
  const face = card.rank === 14 ? "a" : card.rank === 13 ? "k" : card.rank === 12 ? "q" : card.rank === 11 ? "j" : String(card.rank);
  return `${DIR}/card-front-${SUIT_NAME[card.suit]}-${face}.${isGold(card, lucky) ? "gold.v1" : "v4"}.webp`;
}
export const isGold = (card: Card, lucky: number | null) => lucky !== null && card.rank === lucky;

export const CARD_BACK_SRC = `${DIR}/card-back.v2.webp`;

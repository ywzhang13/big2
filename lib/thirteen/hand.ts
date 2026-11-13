// 十三支牌型判斷與比較（規則書 3.1～3.3、2.4 倒水）。
// 每一道算成 { cat 等級, keys 比較序 }；比較時先比等級，再逐項比比較序，長度不同（頭道對中道）只比到短的那邊。
import type { Card } from "./cards";

/** 牌型等級（五張、三張共用；三張只會有 3 三條、1 一對、0 烏龍） */
export const CAT = {
  FIVE_KIND: 11,       // 五龍（五條）
  STRAIGHT_FLUSH: 10,  // 同花順
  FOUR_KIND: 9,        // 鐵支
  FULL_HOUSE: 8,       // 葫蘆
  FLUSH_TWO_PAIR: 7,   // 同花兩對（只會發生在黑桃）
  FLUSH_PAIR: 6,       // 同花一對（呸同）
  FLUSH: 5,            // 同花
  STRAIGHT: 4,         // 順子
  THREE_KIND: 3,       // 三條
  TWO_PAIR: 2,         // 兩對
  PAIR: 1,             // 一對
  HIGH: 0,             // 烏龍（散牌）
} as const;
export type Category = (typeof CAT)[keyof typeof CAT];

export const CAT_NAME: Record<number, string> = {
  11: "五龍", 10: "同花順", 9: "鐵支", 8: "葫蘆", 7: "同花兩對", 6: "同花一對",
  5: "同花", 4: "順子", 3: "三條", 2: "兩對", 1: "一對", 0: "烏龍",
};

export interface HandValue {
  cat: Category;
  keys: number[]; // 比較序，大的在前
}

/** 依「張數多的先、同張數點數大的先」排出每組點數，例如葫蘆 [三條點數, 對子點數]、兩對 [大對, 小對, 踢腳] */
function groups(cards: Card[]): { rank: number; n: number }[] {
  const m = new Map<number, number>();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  return [...m].map(([rank, n]) => ({ rank, n })).sort((a, b) => b.n - a.n || b.rank - a.rank);
}

/** 五張牌的牌型 */
export function evalFive(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error("中道、尾道要 5 張");
  const g = groups(cards);
  const keys = g.map((x) => x.rank);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  let straightTop = 0;
  if (g.length === 5) {
    const r = keys; // 5 種點數，由大到小
    if (r[0] - r[4] === 4) straightTop = r[0];
    else if (r[0] === 14 && r[1] === 5 && r[4] === 2) straightTop = 5; // A-2-3-4-5，頂張算 5
  }
  if (g[0].n === 5) return { cat: CAT.FIVE_KIND, keys };
  if (flush && straightTop) return { cat: CAT.STRAIGHT_FLUSH, keys: [straightTop] };
  if (g[0].n === 4) return { cat: CAT.FOUR_KIND, keys };
  if (g[0].n === 3 && g[1].n === 2) return { cat: CAT.FULL_HOUSE, keys };
  if (flush && g[0].n === 2 && g[1].n === 2) return { cat: CAT.FLUSH_TWO_PAIR, keys };
  if (flush && g[0].n === 2) return { cat: CAT.FLUSH_PAIR, keys };
  if (flush) return { cat: CAT.FLUSH, keys };
  if (straightTop) return { cat: CAT.STRAIGHT, keys: [straightTop] };
  if (g[0].n === 3) return { cat: CAT.THREE_KIND, keys };
  if (g[0].n === 2 && g[1].n === 2) return { cat: CAT.TWO_PAIR, keys };
  if (g[0].n === 2) return { cat: CAT.PAIR, keys };
  return { cat: CAT.HIGH, keys };
}

/** 頭道三張：只有三條、一對、烏龍（三張的順子、同花不算） */
export function evalThree(cards: Card[]): HandValue {
  if (cards.length !== 3) throw new Error("頭道要 3 張");
  const g = groups(cards);
  const keys = g.map((x) => x.rank);
  if (g[0].n === 3) return { cat: CAT.THREE_KIND, keys };
  if (g[0].n === 2) return { cat: CAT.PAIR, keys };
  return { cat: CAT.HIGH, keys };
}

export const evalRow = (cards: Card[]) => (cards.length === 3 ? evalThree(cards) : evalFive(cards));

/** a 比 b 大回正數、小回負數、一樣大回 0。先比等級，再逐項比比較序，只比到較短的那邊（頭道對中道用） */
export function compareValue(a: HandValue, b: HandValue): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.min(a.keys.length, b.keys.length);
  for (let i = 0; i < n; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
  return 0;
}

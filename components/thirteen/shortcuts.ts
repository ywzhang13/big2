// 理牌的牌型快捷鈕：從還在手牌裡的牌找出某種牌型的所有組合，由大到小排好給按鈕輪選。
// 牌型判斷和大小比較用計分引擎（lib/thirteen 的 evalFive／evalThree／compareValue），這裡只負責列舉和去重。
// 唯一例外是「對子」：兩張同點數（見下面 pair 那段的理由）。
import { CAT, compareValue, evalFive, evalThree, type Card, type HandRule, type HandValue } from "@/lib/thirteen";

export type ShortcutKind = "fiveKind" | "straightFlush" | "fourKind" | "fullHouse" | "flush" | "straight" | "threeKind" | "pair";

export const SHORTCUTS: { kind: ShortcutKind; label: string }[] = [
  { kind: "fiveKind", label: "五龍" }, // 老闆 2026-11-23：按鈕沒有做五龍的
  { kind: "straightFlush", label: "同花順" },
  { kind: "fourKind", label: "鐵支" },
  { kind: "fullHouse", label: "葫蘆" },
  { kind: "flush", label: "同花" },
  { kind: "straight", label: "順子" },
  { kind: "threeKind", label: "三條" },
  { kind: "pair", label: "對子" },
];

/** 五張牌型對應的引擎等級。同花包含同花一對、同花兩對（都是五張同花色）；v4 的黑桃同花順、彩金鐵支、彩金葫蘆歸在同一顆鈕 */
const FIVE_CATS: Partial<Record<ShortcutKind, number[]>> = {
  fiveKind: [CAT.FIVE_KIND],
  straightFlush: [CAT.STRAIGHT_FLUSH, CAT.SPADE_STRAIGHT_FLUSH],
  fourKind: [CAT.FOUR_KIND, CAT.LUCKY_FOUR],
  fullHouse: [CAT.FULL_HOUSE, CAT.LUCKY_FULL_HOUSE],
  flush: [CAT.FLUSH, CAT.FLUSH_PAIR, CAT.FLUSH_TWO_PAIR],
  straight: [CAT.STRAIGHT],
};

function* subsets(cards: Card[], k: number, start = 0, pick: Card[] = []): Generator<Card[]> {
  if (pick.length === k) { yield pick.slice(); return; }
  for (let i = start; i <= cards.length - (k - pick.length); i++) {
    pick.push(cards[i]);
    yield* subsets(cards, k, i + 1, pick);
    pick.pop();
  }
}

/**
 * 去重：同一個「核心」只留一組，避免按鈕一直輪到只差花色或踢腳的組合。
 * 鐵支看四條的點數、留踢腳最小的那組（不浪費大牌）；葫蘆看三條＋對子點數；其他看整組的比較序。
 */
function coreKey(v: HandValue): string {
  if (v.cat === CAT.FOUR_KIND || v.cat === CAT.LUCKY_FOUR) return `${v.cat}:${v.keys[0]}`;
  if (v.cat === CAT.FULL_HOUSE || v.cat === CAT.LUCKY_FULL_HOUSE) return `${v.cat}:${v.keys[0]}:${v.keys[1]}`;
  return `${v.cat}:${v.keys.join(",")}`;
}

/** 回傳這種牌型的所有組合（每組是牌的陣列），最大的在前。湊不出來回空陣列；rule＝這一局的牌型規則（v4 帶彩金點數，伺服器同一套） */
export function findCombos(hand: Card[], kind: ShortcutKind, rule?: HandRule): Card[][] {
  const found: { cards: Card[]; value: HandValue }[] = [];
  const five = FIVE_CATS[kind];
  if (five) {
    for (const s of subsets(hand, 5)) {
      const value = evalFive(s, rule);
      if (five.includes(value.cat)) found.push({ cards: s, value });
    }
  } else if (kind === "threeKind") {
    for (const s of subsets(hand, 3)) {
      const value = evalThree(s, rule);
      if (value.cat === CAT.THREE_KIND || value.cat === CAT.LUCKY_THREE) found.push({ cards: s, value });
    }
  } else {
    // 對子＝兩張同點數（阿哲 2026-11-18 拍板保留的例外）：快捷鈕只是「幫忙選牌」，不決定牌型。
    // 選出的牌放進墩以後，墩的牌型和加分仍由引擎 evalRow／bonusOf 判斷（tests/_thirteen-arrange.ts R1、R2）。
    // 引擎沒有兩張牌的判斷，「同點數」本身就是對子的定義，不涉及計分規則。
    for (const s of subsets(hand, 2)) {
      if (s[0].rank === s[1].rank) found.push({ cards: s, value: { cat: CAT.PAIR, keys: [s[0].rank] } });
    }
  }
  // 由大到小；同一核心留一組（鐵支留踢腳最小的，所以同核心時小的蓋掉大的）
  found.sort((a, b) => compareValue(b.value, a.value));
  const byCore = new Map<string, Card[]>();
  for (const f of found) {
    const key = coreKey(f.value);
    if (!byCore.has(key) || f.value.cat === CAT.FOUR_KIND || f.value.cat === CAT.LUCKY_FOUR) byCore.set(key, f.cards);
  }
  return [...byCore.values()];
}

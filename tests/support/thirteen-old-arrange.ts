// 測試用（老柯 2026-11-18）：14a83b2 版的 autoArrange（只比牌型強弱、不管牌型加分），原封不動留一份，給新舊判準對照用。
// 新版見 lib/thirteen/arrange.ts。
import type { Card } from "../../lib/thirteen/cards";
import type { Arrangement } from "../../lib/thirteen/arrange";
import { compareValue, evalFive, evalThree, type HandValue } from "../../lib/thirteen/hand";

/** 從 cards 裡挑 5 張最大的組合：回傳一樣大的全部選法（同點數不同張、例如兩張 ♠K 或不同花色的 K，會留下不同的牌給下一墩） */
function bestFives(cards: Card[]): { picks: Card[][]; value: HandValue } {
  let best: { picks: Card[][]; value: HandValue } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const pick = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      const value = evalFive(pick);
      const cmp = best ? compareValue(value, best.value) : 1;
      if (cmp > 0) best = { picks: [pick], value };
      else if (cmp === 0) best!.picks.push(pick);
    }
  return best!;
}

/** 從 cards 裡挑 3 張最大的組合（頭道） */
function bestThree(cards: Card[]): { pick: Card[]; value: HandValue } {
  let best: { pick: Card[]; value: HandValue } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    const pick = [cards[a], cards[b], cards[c]];
    const value = evalThree(pick);
    if (!best || compareValue(value, best.value) > 0) best = { pick, value };
  }
  return best!;
}

/**
 * 理牌時間到了（或斷線）由系統自動排牌：從手牌（加一色每人 16 張；也收 13 張）挑 13 張，排出「最好」的三墩，保證不倒水。
 * 「最好」的判準（規則書 2.7，小測 2026-11-18 要求寫清楚）：在所有不倒水的排法裡，先比尾道，尾道一樣大再比中道，
 * 中道也一樣再比頭道，取最大的一組（字典序最大）。沒挑到的牌就是不用的。不考慮對手，也不額外追特殊加分。
 * 做法：
 *   1. 尾道＝手牌裡最大的 5 張。同樣大的選法可能不只一種（例如葫蘆用哪幾張 K、順子用哪個花色），每一種都試。
 *   2. 每種尾道，中道＝剩下的牌裡最大的 5 張；一樣大的選法也每一種都試。
 *   3. 頭道＝再剩下的牌裡最大的 3 張。
 *   比完所有組合取字典序最大的。不倒水：尾道是全部手牌最大的 5 張，一定不小於中道；中道是剩下牌裡最大的 5 張，
 *   頭道 3 張也在剩下的牌裡，所以中道不小於「頭道＋任意 2 張」，也就不小於頭道。
 * 一樣大的選法通常只有幾種，16 張一手約幾毫秒。
 */
export function oldAutoArrange(cards: Card[]): Arrangement {
  if (cards.length < 13) throw new Error("自動排牌至少要 13 張");
  const backs = bestFives(cards);
  let best: { arr: Arrangement; middle: HandValue; front: HandValue } | null = null;
  for (const back of backs.picks) {
    const rest = cards.filter((c) => !back.includes(c));
    const middles = bestFives(rest);
    for (const middle of middles.picks) {
      const front = bestThree(rest.filter((c) => !middle.includes(c)));
      const better = !best || compareValue(middles.value, best.middle) > 0
        || (compareValue(middles.value, best.middle) === 0 && compareValue(front.value, best.front) > 0);
      if (better) best = { arr: { front: front.pick, middle, back }, middle: middles.value, front: front.value };
    }
  }
  return best!.arr;
}

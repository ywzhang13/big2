// 測試用參考答案（老柯 2026-11-18）：用窮舉找出「最好的 13 張排法」，拿來檢查 lib/thirteen/arrange.ts 的 autoArrange。
// 「最好」的判準（和 autoArrange 相同，見規則書 2.7）：在所有不倒水的排法裡，先比尾道、尾道一樣大再比中道、中道也一樣再比頭道，
// 取最大的那一組（字典序最大）。這裡把所有尾道（5 張）× 剩下牌的所有中道（5 張）× 再剩下牌的所有頭道（3 張）全部列出來比，
// 不靠任何「先挑最大的」捷徑，所以可以當作獨立的對照。張數多時很慢，只給測試用。
import type { Card } from "../../lib/thirteen/cards";
import { compareValue, evalFive, evalThree, type HandValue } from "../../lib/thirteen/hand";

export type Triple = { back: HandValue; middle: HandValue; front: HandValue };
export const cmpTriple = (a: Triple, b: Triple) => compareValue(a.back, b.back) || compareValue(a.middle, b.middle) || compareValue(a.front, b.front);

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** 窮舉所有不倒水的排法，回傳字典序最大的三墩牌型（尾、中、頭） */
export function bestTripleByBruteForce(cards: Card[]): Triple {
  const n = cards.length;
  const five = new Map<number, HandValue>(), three = new Map<number, HandValue>();
  const maskOf = (idx: number[]) => idx.reduce((m, i) => m | (1 << i), 0);
  const v5 = (idx: number[]) => { const m = maskOf(idx); let v = five.get(m); if (!v) { v = evalFive(idx.map((i) => cards[i])); five.set(m, v); } return v; };
  const v3 = (idx: number[]) => { const m = maskOf(idx); let v = three.get(m); if (!v) { v = evalThree(idx.map((i) => cards[i])); three.set(m, v); } return v; };
  let best: Triple | null = null;
  for (const b of combos(n, 5)) {
    const restB = [...Array(n).keys()].filter((i) => !b.includes(i));
    const back = v5(b);
    for (const mIdx of combos(restB.length, 5)) {
      const m = mIdx.map((i) => restB[i]);
      const middle = v5(m);
      if (compareValue(middle, back) > 0) continue; // 倒水
      const restM = restB.filter((i) => !m.includes(i));
      for (const fIdx of combos(restM.length, 3)) {
        const front = v3(fIdx.map((i) => restM[i]));
        if (compareValue(front, middle) > 0) continue; // 倒水
        const t = { back, middle, front };
        if (!best || cmpTriple(t, best) > 0) best = t;
      }
    }
  }
  return best!;
}

// 推薦排法、逾時代排要把牌型加分算進去（阿哲 2026-11-18 拍板；老馬實測三張 Q 被拆成一對）
// 判準：所有不倒水的排法裡，先比三墩的牌型加分合計（頭墩衝三、中尾墩鐵支／同花順／五龍，照計分規則的加分表），
//       加分一樣多再比尾道、中道、頭道（字典序最大）。
//   B1 三張 Q 可以放頭墩、其他牌排得出不倒水的中尾墩：頭墩是衝三（舊判準會把一張 Q 拿去湊尾墩同花，拆成一對）
//   B2 鐵支不被拆散（一組鐵支放尾墩；兩組鐵支時小的放中墩拿中墩鐵支加分）
//   B3 同花順、五龍不被拆散
//   B4 這些例子都和窮舉所有不倒水排法的最佳（新判準）完全相同；B4b 另外隨機 15 手拿得到加分的也是
//   B5 前後對照：同一批固定種子的 2000 手 16 張，新判準的平均牌型加分不低於舊判準，而且每一手都不低於
//   B6 伺服器單次計算時間：列出平均和最慢（2000 手）
import { buildDeck, parseCards, shuffle, type Card } from "../lib/thirteen/cards";
import { autoArrange as autoArrangeR, checkArrangement as checkArrangementR, type Arrangement } from "../lib/thirteen/arrange";
import { CAT, evalFive as evalFiveR, evalThree, type HandRule } from "../lib/thirteen/hand";
import { bonusOf as bonusOfR, type Row } from "../lib/thirteen/score";
import { bestTripleByBruteForce as bestR, bonusSum as bonusSumR, cmpBonusTriple as cmpBonusTripleR, type Triple } from "./support/thirteen-best-ref";
import { oldAutoArrange } from "./support/thirteen-old-arrange";
// 2026-11-19 v4 上線後，函式沒指定規則＝v4；這支測試寫的是舊規則，這裡把預設釘回舊規則（v4 另有 _thirteen-rule-v4.ts）
const autoArrange = (c: Card[], r: HandRule = "legacy") => autoArrangeR(c, r);
const checkArrangement = (a: Arrangement, r: HandRule = "legacy") => checkArrangementR(a, r);
const evalFive = (c: Card[], r: HandRule = "legacy") => evalFiveR(c, r);
const bonusOf = (row: Row, v: Parameters<typeof bonusOfR>[1]) => bonusOfR(row, v, "v1");
const bestTripleByBruteForce = (c: Card[]) => bestR(c, { rule: "legacy" });
const bonusSum = (t: Triple) => bonusSumR(t, "legacy");
const cmpBonusTriple = (a: Triple, b: Triple) => cmpBonusTripleR(a, b, "legacy");

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const triple = (a: Arrangement) => ({ back: evalFive(a.back), middle: evalFive(a.middle), front: evalThree(a.front) });
const bonus = (a: Arrangement) => { const t = triple(a); return bonusOf("front", t.front) + bonusOf("middle", t.middle) + bonusOf("back", t.back); };
const show = (cs: Card[]) => cs.map((c) => c.id.slice(0, 2)).join(" ");
const fromMine = (a: Arrangement, h: Card[]) => [...a.front, ...a.middle, ...a.back].every((c) => h.includes(c));

// B1：老馬實測的情況
const h1 = parseCards("QS QH QD 2C 3C 4C 5C 6D 7H 8H 9H JH KH TD 4S 8D");
{
  const a = autoArrange(h1), old = oldAutoArrange(h1);
  eq([evalThree(a.front).cat, a.front.every((c) => c.rank === 12), bonus(a), checkArrangement(a).ok, fromMine(a, h1), evalThree(old.front).cat === CAT.THREE_KIND, bonus(old)],
    [CAT.THREE_KIND, true, 2, true, true, false, 0],
    `B1 三張 Q＋排得出順子中墩、同花尾墩：頭墩是衝三（QQQ，加分 2）。舊判準把 Q♥ 拿去湊尾墩同花，頭墩變成 ${show(old.front)}，加分 0`);
}
// B2：鐵支
const h2 = parseCards("KS KH KD KC 2C 3D 5H 7S 9C JD 4H 6C 8D TS QH AS");
const h2b = parseCards("AS AH AD AC KS KH KD KC 2C 3D 5H 7S 9C JD 4H 6D");
{
  const a = autoArrange(h2), b = autoArrange(h2b);
  // 兩組鐵支：直接數尾墩有 4 張 A、中墩有 4 張 K（小測 2026-11-18 要求直接斷言位置）
  eq([evalFive(a.back).cat, a.back.filter((c) => c.rank === 13).length, evalFive(b.back).cat, evalFive(b.middle).cat,
    b.back.filter((c) => c.rank === 14).length, b.middle.filter((c) => c.rank === 13).length, bonus(b), checkArrangement(b).ok],
    [CAT.FOUR_KIND, 4, CAT.FOUR_KIND, CAT.FOUR_KIND, 4, 4, 6, true],
    "B2 一組鐵支（四張 K）整組放尾墩不被拆散；兩組鐵支時 A 的放尾墩、K 的放中墩（尾墩鐵支 2＋中墩鐵支 4＝加分 6）");
}
// B3：同花順、五龍
const h3 = parseCards("5H 6H 7H 8H 9H 2C 2D 3S 4C JD QC KS AD TC 3D 7C");
const h4 = parseCards("AS AS AH AD AC 2C 3D 5H 7S 9C JD 4H 6C 8D TS QH");
{
  const a = autoArrange(h3), b = autoArrange(h4);
  const sf = [a.middle, a.back].some((r) => evalFive(r).cat === CAT.STRAIGHT_FLUSH && r.every((c) => c.suit === "H"));
  eq([sf, bonus(a) >= 3, evalFive(b.back).cat, b.back.every((c) => c.rank === 14), bonus(b) >= 4],
    [true, true, CAT.FIVE_KIND, true, true], "B3 同花順（紅心 5～9）整組留在中墩或尾墩；五張 A 整組放尾墩（五龍）");
}
// B4：和窮舉的最佳完全相同
{
  const hs = [h1, h2, h2b, h3, h4];
  eq(hs.map((h) => cmpBonusTriple(triple(autoArrange(h)), bestTripleByBruteForce(h))), [0, 0, 0, 0, 0],
    "B4 上面 5 手都和窮舉所有不倒水排法的最佳（先比牌型加分，再比尾、中、頭）完全相同");
}
// B4b：隨機找 15 手「手上有加分組合」的 16 張（有三條／鐵支／同花順／五龍，用牌本身判斷、不靠 autoArrange 挑），
//      也和窮舉的最佳完全相同（剪枝、指定加分組合的做法沒有漏掉更好的排法）
function hasBonusCombo(h: Card[]): boolean {
  const n = h.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    if (bonusOf("front", evalThree([h[a], h[b], h[c]])) > 0) return true;
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const v = evalFive([h[a], h[b], h[c], h[d], h[e]]);
      if (bonusOf("middle", v) > 0 || bonusOf("back", v) > 0) return true;
    }
  }
  return false;
}
{
  let seed = 4242; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const picked: Card[][] = [];
  while (picked.length < 15) {
    const d = shuffle(buildDeck(), rng);
    for (let i = 0; i < 4 && picked.length < 15; i++) { const h = d.slice(i * 16, i * 16 + 16); if (hasBonusCombo(h)) picked.push(h); }
  }
  const refs = picked.map((h) => bestTripleByBruteForce(h));
  const diff = picked.map((h, i) => cmpBonusTriple(triple(autoArrange(h)), refs[i]));
  eq([picked.length, diff.filter((x) => x !== 0).length], [15, 0], `B4b 隨機 15 手手上有加分組合的 16 張（窮舉最佳的加分 ${refs.map(bonusSum).join("、")}）：autoArrange 都和窮舉的最佳完全相同`);
}
// B5、B6：前後對照與計算時間
{
  let seed = 20261118; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let oldSum = 0, newSum = 0, worse = 0, better = 0, n = 0, foul = 0;
  const times: number[] = [];
  for (let g = 0; g < 500; g++) {
    const d = shuffle(buildDeck(), rng);
    for (let i = 0; i < 4; i++) {
      const h = d.slice(i * 16, i * 16 + 16);
      const t0 = performance.now(); const a = autoArrange(h); times.push(performance.now() - t0);
      const o = oldAutoArrange(h);
      const nb = bonus(a), ob = bonus(o);
      newSum += nb; oldSum += ob; n++;
      if (nb < ob) worse++; if (nb > ob) better++;
      if (!checkArrangement(a).ok || !fromMine(a, h)) foul++;
    }
  }
  times.sort((x, y) => x - y);
  const avg = times.reduce((x, y) => x + y, 0) / times.length, max = times[times.length - 1], p99 = times[Math.floor(times.length * 0.99)];
  eq([n, worse, foul, newSum >= oldSum, better > 0], [2000, 0, 0, true, true],
    `B5 前後對照（固定種子 2000 手 16 張）：平均牌型加分 舊 ${(oldSum / n).toFixed(3)} → 新 ${(newSum / n).toFixed(3)}；${better} 手變多、0 手變少；全部不倒水、都是本人的牌`);
  eq([avg < 50, max < 1000], [true, true], `B6 伺服器單次計算時間（2000 手 16 張）：平均 ${avg.toFixed(2)} 毫秒、99% 在 ${p99.toFixed(2)} 毫秒內、最慢 ${max.toFixed(2)} 毫秒`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

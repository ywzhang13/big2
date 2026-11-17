// 加一色「每人發 16 張、自己挑 13 張理牌、3 張不用」（老闆 2026-11-18 拍板）
//   G1 發牌：每人 16 張、四家互不重複、剩 1 張；65 張一張不少（固定種子 2000 次都成立）
//   G2 送出：三墩 13 張全來自本人 16 張就收（另外 3 張不用）；混入別家的牌、混入沒發出去的那 1 張都擋 not_your_card；
//      張數不對（12、14 張）擋 bad_size；重複擋 duplicate_card；不用的 3 張不在排法裡
//   G3 自動排牌：從 16 張挑出 13 張排好，牌都來自本人、不重複、剛好留下 3 張，不倒水
//   G4（2026-11-18 起拿掉）：原本斷言「尾道一定是 16 張裡最大的 5 張」；判準改成牌型加分優先後，為了保留衝三等加分，尾道可能不是最大的 5 張（判準的證明見 G7）
//   G5 隨機 1 萬局（4 萬手 16 張）：自動排牌都不倒水、都是 13 張且來自本人
//   G6 13 張的自動排牌（舊流程、規則書範例）結果和原本一樣：尾道是最大 5 張、中道是剩下最大 5 張、頭道是最後 3 張
//   G7「最好的 13 張」判準（阿哲 2026-11-18 拍板）：所有不倒水的排法裡先比牌型加分合計，一樣多再比尾道、中道、頭道（字典序最大）。
//      拿窮舉所有排法的參考答案（tests/support/thirteen-best-ref.ts）對照：
//      a. 舊做法（每墩只取第一個最大的選法）會漏掉的 3 手：尾道一樣大，但用了「錯的那幾張」，害中道少一個同花
//      b. 隨機 30 手 16 張：autoArrange 的三墩牌型和窮舉的最佳完全相同
import { buildDeck, deal, parseCards, shuffle, type Card } from "../lib/thirteen/cards";
import { autoArrange, checkArrangement, validateSubmission } from "../lib/thirteen/arrange";
import { compareValue, evalFive, evalThree } from "../lib/thirteen/hand";
import { bestTripleByBruteForce, cmpBonusTriple } from "./support/thirteen-best-ref";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);
const safeAuto = (cs: Card[]) => { try { return autoArrange(cs); } catch (e) { return (e as Error).message; } };

// G1
{
  const r = rng(1118);
  let bad = 0;
  const sample = deal(r);
  for (let i = 0; i < 2000; i++) {
    const { hands, rest } = deal(r);
    const all = [...hands.flat(), ...rest].map((c) => c.id);
    if (hands.some((h) => h.length !== 16) || rest.length !== 1 || all.length !== 65 || new Set(all).size !== 65) bad++;
  }
  eq([sample.hands.map((h) => h.length), sample.rest.length, new Set(ids(sample.hands.flat())).size, bad], [[16, 16, 16, 16], 1, 64, 0],
    "G1 發牌：每人 16 張、四家 64 張互不重複、剩 1 張不發；固定種子 2000 次 65 張都一張不少、不重複");
}

// G2
{
  const { hands, rest } = deal(rng(7));
  const mine = hands[0];
  const pick = mine.slice(0, 13), unused = mine.slice(13);
  const sub = (cs: Card[]) => ({ front: ids(cs.slice(0, 3)), middle: ids(cs.slice(3, 8)), back: ids(cs.slice(8, 13)) });
  // 用 autoArrange 拿一組不倒水的 13 張當「合法送出」（autoArrange 修正前只收 13 張，這裡給它前 13 張）
  const legal = autoArrange(pick);
  const ok = validateSubmission(mine, { front: ids(legal.front), middle: ids(legal.middle), back: ids(legal.back) });
  const usedIds = ok.ok ? ids([...ok.arrangement.front, ...ok.arrangement.middle, ...ok.arrangement.back]) : [];
  const others = validateSubmission(mine, sub([...pick.slice(0, 12), hands[1][0]]));
  const undealt = validateSubmission(mine, sub([...pick.slice(0, 12), rest[0]]));
  const twelve = validateSubmission(mine, { front: ids(pick.slice(0, 3)), middle: ids(pick.slice(3, 8)), back: ids(pick.slice(8, 12)) });
  const fourteen = validateSubmission(mine, { front: ids(mine.slice(0, 4)), middle: ids(mine.slice(4, 9)), back: ids(mine.slice(9, 14)) });
  const dup = validateSubmission(mine, sub([...pick.slice(0, 12), pick[0]]));
  const err = (r: ReturnType<typeof validateSubmission>) => (r.ok ? "ok" : r.error);
  eq([ok.ok, usedIds.length, unused.some((c) => usedIds.includes(c.id)), err(others), err(undealt), err(twelve), err(fourteen), err(dup)],
    [true, 13, false, "not_your_card", "not_your_card", "bad_size", "bad_size", "duplicate_card"],
    "G2 送出 13 張全來自本人 16 張：收下（另外 3 張不在排法裡）；混入別家的牌、沒發出去的那張都擋 not_your_card；12、14 張擋 bad_size；重複擋 duplicate_card");
}

// G3
{
  const { hands } = deal(rng(42));
  const mine = hands[2];
  const a = safeAuto(mine);
  const res = typeof a === "string" ? a : (() => {
    const used = ids([...a.front, ...a.middle, ...a.back]);
    return [used.length, new Set(used).size, used.every((id) => mine.some((c) => c.id === id)), mine.length - used.length, checkArrangement(a).ok];
  })();
  eq(res, [13, 13, true, 3, true], "G3 自動排牌從 16 張挑 13 張：都來自本人、不重複、剛好留 3 張、不倒水（挑哪 13 張的判準見 G7）");
}

// G5：隨機 1 萬局
{
  const r = rng(20261118);
  let hands16 = 0, len16 = 0, bad = 0, notThirteen = 0, notMine = 0, threw = "";
  for (let g = 0; g < 10000; g++) {
    for (const h of deal(r).hands) {
      hands16++;
      if (h.length === 16) len16++;
      const a = safeAuto(h);
      if (typeof a === "string") { threw ||= a; bad++; continue; }
      const used = [...a.front, ...a.middle, ...a.back];
      if (used.length !== 13 || new Set(ids(used)).size !== 13) notThirteen++;
      if (used.some((c) => !h.includes(c))) notMine++;
      if (!checkArrangement(a).ok) bad++;
    }
  }
  eq([hands16, len16, bad, notThirteen, notMine, threw], [40000, 40000, 0, 0, 0, ""], "G5 隨機 1 萬局（4 萬手 16 張）：自動排牌都不倒水、都是本人的 13 張");
}

// G6：13 張照舊
{
  const r = rng(99);
  let diff = 0;
  for (let i = 0; i < 2000; i++) {
    const h = shuffle(buildDeck(), r).slice(0, 13);
    const a = autoArrange(h);
    const rest = h.filter((c) => !a.back.includes(c));
    // 舊做法：尾道最大 5 張、中道剩下最大 5 張、頭道是最後 3 張 → 頭道一定就是排完尾、中後剩下的那 3 張
    if (a.front.length !== 3 || rest.filter((c) => !a.middle.includes(c)).some((c) => !a.front.includes(c))) diff++;
  }
  const ex = autoArrange(parseCards("2C 3D 7H 8H 8D 9C 9D KH AS 2S 3H 4D 5C"));
  eq([diff, checkArrangement(ex).ok], [0, true], "G6 13 張的自動排牌（舊流程、規則書範例用）照舊：頭道就是尾、中排完剩下的 3 張；2000 手都一樣");
}

// G7
{
  const fromId = (id: string): Card => ({ id, suit: id[0] as Card["suit"], rank: "23456789TJQKA".indexOf(id[1]) + 2, deck: Number(id[2]) as 1 | 2 });
  const tripleOf = (h: Card[]) => { const a = autoArrange(h); return { back: evalFive(a.back), middle: evalFive(a.middle), front: evalThree(a.front) }; };
  const fmt = (t: ReturnType<typeof tripleOf>) => `${t.back.cat}/${t.middle.cat}/${t.front.cat}`;
  // 舊做法漏掉的 3 手（240 手隨機牌裡找到 8 手，這裡取前 3 手）：尾道葫蘆、鐵支，用哪幾張會決定中道能不能湊同花
  const known = [
    "S62 SK2 H71 SK1 S61 DK1 D91 H31 D71 HJ1 HA1 C41 H21 DJ1 SJ2 S81",
    "SA1 S92 S52 H81 S31 S42 D81 SQ2 CA1 HA1 SK2 H21 C81 CJ1 S81 D21",
    "DT1 SQ1 C41 S92 H21 S42 H81 HK1 SA1 SJ2 S51 HA1 C31 CA1 C51 D51",
  ].map((x) => x.split(" ").map(fromId));
  const refs = known.map((h) => bestTripleByBruteForce(h));
  eq(known.map((h, i) => cmpBonusTriple(tripleOf(h), refs[i])), [0, 0, 0],
    `G7a 舊做法會漏掉的 3 手：尾道一樣大（葫蘆、鐵支），改成每種一樣大的選法都試之後，三墩和窮舉的最佳完全相同（最佳的尾/中/頭牌型：${refs.map(fmt).join("、")}）`);
  const r = rng(777);
  let same = 0, n = 0;
  for (let g = 0; g < 8 && n < 30; g++) for (const h of deal(r).hands) { if (n >= 30) break; n++; if (cmpBonusTriple(tripleOf(h), bestTripleByBruteForce(h)) === 0) same++; }
  eq([n, same], [30, 30], "G7b 隨機 30 手 16 張：autoArrange 的結果和窮舉所有不倒水排法的最佳完全相同（先比牌型加分，再比尾、中、頭）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

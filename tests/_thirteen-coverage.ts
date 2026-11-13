// 十三支計分引擎：補測試（審伯 2026-11-13 兩項必修＋小測〈十三支計分引擎-測試覆蓋審查-2026-11-13〉的缺口）。
// 每一段開頭的【】標出對應的審查項目。四人牌局一律用不重複的合法牌（parseCards 共用 used，同一張牌用超過張數會直接丟錯）。
import { buildDeck, deal, makeCard, parseCards, shuffle, type Card } from "../lib/thirteen/cards";
import { autoArrange, checkArrangement, validateSubmission, type Arrangement } from "../lib/thirteen/arrange";
import { CAT, CAT_NAME, compareValue, evalFive, evalThree } from "../lib/thirteen/hand";
import { scoreRound } from "../lib/thirteen/score";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const five = (s: string) => evalFive(parseCards(s));
const three = (s: string) => evalThree(parseCards(s));
const sign = (n: number) => Math.sign(n);

// ===== 審伯必修 1：洗牌、發牌用密碼學安全亂數 =====
{
  const orig = Math.random;
  Math.random = () => { throw new Error("不該用 Math.random"); };
  let ok = true, info = "";
  try {
    const { hands, rest } = deal();
    const ids = [...hands.flat(), ...rest].map((c) => c.id);
    info = `${ids.length} 張、不重複 ${new Set(ids).size}`;
    ok = ids.length === 65 && new Set(ids).size === 65 && hands.every((h) => h.length === 13) && rest.length === 13;
    shuffle([1, 2, 3, 4, 5]);
  } catch (e) { ok = false; info = (e as Error).message; }
  Math.random = orig;
  eq([ok, info], [true, "65 張、不重複 65"], "必修 1：Math.random 會丟錯時，不帶參數的 deal()、shuffle() 照常完成，65 張不重複不遺漏（預設用 crypto）");

  const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  let threw = "";
  try { deal(); } catch (e) { threw = (e as Error).message; }
  if (desc) Object.defineProperty(globalThis, "crypto", desc);
  eq(threw.includes("密碼學安全"), true, "必修 1：取不到 crypto 時直接丟錯，不會退回 Math.random");

  let s = 7; const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const a = deal(rng).hands[0].map((c) => c.id).join();
  s = 7; const b = deal(rng).hands[0].map((c) => c.id).join();
  eq(a === b, true, "必修 1：測試明確注入固定種子時，發牌可以重現");
  // 分布粗檢：洗 4 張牌 24000 次，第一張是哪一張大約各 1/4
  const count = [0, 0, 0, 0];
  for (let i = 0; i < 24000; i++) count[shuffle([0, 1, 2, 3])[0]]++;
  eq(count.every((n) => n > 5400 && n < 6600), true, `必修 1：安全亂數洗牌分布平均（第一張各出現 ${count.join("／")} 次，期望各約 6000）`);
}

// ===== 審伯必修 2：送牌檢查遇到怪輸入回失敗、不丟錯 =====
{
  const { hands } = deal();
  const mine = hands[0];
  const ar = autoArrange(mine);
  const ids = (xs: Card[]) => xs.map((c) => c.id);
  const good = { front: ids(ar.front), middle: ids(ar.middle), back: ids(ar.back) };
  const bad: [string, unknown][] = [
    ["null", null], ["undefined", undefined], ["字串", "SA1 SA2"], ["數字", 13], ["陣列", [good.front, good.middle, good.back]],
    ["空物件", {}], ["缺 back", { front: good.front, middle: good.middle }],
    ["front 是字串", { ...good, front: good.front.join(" ") }],
    ["只有 length 的假陣列", { ...good, front: { length: 3, 0: good.front[0], 1: good.front[1], 2: good.front[2] } }],
    ["元素是數字", { ...good, back: [1, 2, 3, 4, 5] }],
    ["元素是 null", { ...good, middle: [null, ...good.middle.slice(1)] }],
    ["元素是物件", { ...good, front: good.front.map((id) => ({ id })) }],
  ];
  const out = bad.map(([name, input]) => {
    try {
      const r = validateSubmission(mine, input);
      return r.ok ? `${name}:通過了` : `${name}:${r.error}`;
    } catch (e) { return `${name}:丟錯 ${(e as Error).message}`; }
  });
  eq(out, bad.map(([name]) => `${name}:bad_input`), "必修 2：null、undefined、字串、數字、陣列、缺欄位、假陣列、非字串元素 → 都回 bad_input，不丟錯");
  const r = validateSubmission(mine, good);
  eq([r.ok, r.ok ? "" : r.message, (validateSubmission(mine, null) as { message: string }).message], [true, "", "送出的資料格式不對"], "必修 2：原本合法的送牌照樣通過；格式錯的中文提示「送出的資料格式不對」");
}

// ===== 【65 張】黑桃每點 2 張、其他花色每點 1 張 =====
{
  const d = buildDeck();
  const n = (suit: string, rank: number) => d.filter((c) => c.suit === suit && c.rank === rank).length;
  const ok = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].every((r) => n("S", r) === 2 && n("H", r) === 1 && n("D", r) === 1 && n("C", r) === 1);
  eq([d.length, ok, d.filter((c) => c.deck === 2).every((c) => c.suit === "S")], [65, true, true], "牌組：65 張；黑桃每點 2 張（第 1、2 副），紅心、方塊、梅花每點 1 張；第 2 副只有黑桃");
}

// ===== 【12 級大小】相鄰兩級逐一比較 =====
{
  const ladder: [string, string][] = [
    ["五龍", "AS AS AH AD AC"], ["同花順", "TS JS QS KS AS"], ["鐵支", "AH AD AC AS KH"], ["葫蘆", "AH AD AC KH KD"],
    ["同花兩對", "AS AS KS KS 2S"], ["同花一對", "AS AS QS JS 9S"], ["同花", "AH QH 9H 5H 2H"], ["順子", "TH JD QC KS AH"],
    ["三條", "AH AD AC KH QD"], ["兩對", "AH AD KH KD QC"], ["一對", "AH AD KH QD JC"], ["烏龍", "AH KD QC JS 9H"],
  ];
  const vals = ladder.map(([, s]) => five(s));
  eq(vals.map((v) => CAT_NAME[v.cat]), ladder.map(([n]) => n), "12 級牌型判斷：五龍、同花順、鐵支、葫蘆、同花兩對、同花一對、同花、順子、三條、兩對、一對、烏龍");
  eq(vals.slice(0, -1).map((v, i) => sign(compareValue(v, vals[i + 1]))), Array(11).fill(1),
    "12 級相鄰排序：每一級都大於下一級（共 11 組相鄰比較，含葫蘆＞同花兩對＞同花一對＞同花）");
  eq(sign(compareValue(five("AS AS AH AD AC"), five("TS JS QS KS AS"))), 1, "五龍（AAAAA）大於最大的同花順（10-A 黑桃）");
}

// ===== 【頭道】三張只有三條、一對、烏龍；三張順子、同花都算烏龍 =====
eq([three("2C 3D 4H").cat, three("2H 5H 9H").cat, three("QH KH AH").cat, three("AH AD KC").cat, three("7H 7D 7C").cat], [CAT.HIGH, CAT.HIGH, CAT.HIGH, CAT.PAIR, CAT.THREE_KIND],
  "頭道：2-3-4（三張順子）、紅心 2-5-9（三張同花）、紅心 Q-K-A 都是烏龍；AA+K 是一對；777 是三條");

// ===== 【A2345／TJQKA／不能繞圈】 =====
eq([
  sign(compareValue(five("TH JD QC KS AH"), five("9H TD JC QS KH"))),  // 10-A ＞ 9-K
  sign(compareValue(five("2H 3D 4C 5S 6H"), five("AH 2D 3C 4S 5H"))),  // 2-6 ＞ A-5
  sign(compareValue(five("TS JS QS KS AS"), five("9S TS JS QS KS"))),  // 同花順 10-A ＞ 9-K
  sign(compareValue(five("2S 3S 4S 5S 6S"), five("AS 2S 3S 4S 5S"))),  // 同花順 2-6 ＞ A-5
  five("AS 2S 3S 4S 5S").cat === CAT.STRAIGHT_FLUSH ? 1 : 0,
  five("KH AD 2C 3S 4H").cat === CAT.HIGH ? 1 : 0, five("JH QD KC AS 2H").cat === CAT.HIGH ? 1 : 0,
], [1, 1, 1, 1, 1, 1, 1], "順子邊界：10-A 最大、A-2-3-4-5 最小（順子和同花順都是）；K-A-2-3-4、J-Q-K-A-2 不能繞圈，是烏龍");

// ===== 【同牌型逐項比較】核心牌、踢腳 =====
const cmp: [string, string, string][] = [
  ["五龍比點數", "AS AS AH AD AC", "KS KS KH KD KC"],
  ["鐵支比核心", "AH AD AC AS 2H", "KH KD KC KS AH"],
  ["鐵支核心相同比踢腳", "AH AD AC AS KH", "AH AD AC AS QH"],
  ["葫蘆比三條", "AH AD AC 2H 2D", "KH KD KC AH AD"],
  ["葫蘆三條相同比對子", "AH AD AC KH KD", "AH AD AC QH QD"],
  ["同花兩對比大對", "AS AS 2S 2S 3S", "KS KS QS QS JS"],
  ["同花兩對大對相同比小對", "AS AS KS KS 2S", "AS AS QS QS KS"],
  ["同花兩對兩對相同比踢腳", "AS AS KS KS 3S", "AS AS KS KS 2S"],
  ["同花一對比對子", "AS AS KS QS JS", "KS KS AS QS JS"],
  ["同花一對對子相同比最後一張踢腳", "AS AS KS QS JS", "AS AS KS QS TS"],
  ["同花比第一張", "AH 9H 7H 5H 3H", "KH QH JH 9H 7H"],
  ["同花前四張相同比最後一張", "AH QH 9H 5H 3H", "AH QH 9H 5H 2H"],
  ["順子比頂張", "9H TD JC QS KH", "8H 9D TC JS QH"],
  ["三條比核心", "AH AD AC 2H 3D", "KH KD KC AS QD"],
  ["三條核心相同比第二踢腳", "AH AD AC KH QD", "AH AD AC KH JD"],
  ["兩對比大對", "AH AD 2H 2D 3C", "KH KD QH QD JC"],
  ["兩對大對相同比小對", "AH AD KH KD 2C", "AS AC QH QD JC"],
  ["兩對大小對相同比踢腳", "AH AD KH KD 3C", "AS AC KS KS 2D"],
  ["一對比對子", "AH AD 2H 3D 4C", "KH KD QH JD 9C"],
  ["一對對子相同比最後踢腳", "AH AD KH QD JC", "AH AD KH QD TC"],
  ["烏龍比最後一張", "AH KD QC JS 9H", "AH KD QC JS 8H"],
];
eq(cmp.map(([n, a, b]) => `${n}:${sign(compareValue(five(a), five(b)))}/${sign(compareValue(five(b), five(a)))}`), cmp.map(([n]) => `${n}:1/-1`),
  `同牌型逐項比較 ${cmp.length} 組：五龍、鐵支、葫蘆、同花兩對、同花一對、同花、順子、三條、兩對、一對、烏龍的核心牌和踢腳（雙向都對）`);
eq([sign(compareValue(three("AH AD KC"), three("AS AC QD"))), sign(compareValue(three("AH KD 3C"), three("AS KC 2D"))), sign(compareValue(three("2H 2D 2C"), three("AH AD KC")))], [1, 1, 1],
  "頭道同型比較：一對比踢腳（AA+K＞AA+Q）、烏龍比最後一張（A-K-3＞A-K-2）、三條（222）大於一對（AA）");

// ===== 【重複黑桃】第一副、第二副同點完全平手 =====
{
  const a = [makeCard("S", 14, 1), makeCard("H", 14, 1), makeCard("D", 13, 1)];
  const b = [makeCard("S", 14, 2), makeCard("D", 14, 1), makeCard("C", 13, 1)];
  const f1 = ["S", "S", "S", "S", "S"].map((s, i) => makeCard(s as "S", [14, 12, 9, 5, 2][i], 1));
  const f2 = ["S", "S", "S", "S", "S"].map((s, i) => makeCard(s as "S", [14, 12, 9, 5, 2][i], 2));
  eq([a[0].id, b[0].id, compareValue(evalThree(a), evalThree(b)), compareValue(evalFive(f1), evalFive(f2))], ["SA1", "SA2", 0, 0],
    "重複黑桃：頭道 ♠A(第一副)♥A♦K 對 ♠A(第二副)♦A♣K 完全平手；第一副黑桃同花對第二副同樣點數的黑桃同花也平手");
}

// ===== 【倒水邊界】中道等於尾道、兩處同時倒水、張數錯、中文提示 =====
{
  const u = new Set<string>();
  const front = parseCards("2C 3D 4H", u), middle = parseCards("AS AH KD QC JD", u), back = parseCards("AD AC KS QH JS", u);
  eq(checkArrangement({ front, middle, back }).ok, true, "倒水邊界：中道 AA+KQJ 和尾道 AA+KQJ 一樣大 → 可以送出");
  const u2 = new Set<string>();
  const both = { front: parseCards("AH AD AC", u2), middle: parseCards("KH KD KC 2H 3D", u2), back: parseCards("4C 4D 6H 7S 9C", u2) };
  const r = checkArrangement(both);
  eq(r.ok ? null : [r.error, r.message], ["foul_front_middle", "倒水：頭道不能比中道大"], "倒水：頭道和中道、中道和尾道同時倒水 → 先回報頭道比中道大，提示「倒水：頭道不能比中道大」");
  const r2 = checkArrangement({ front: parseCards("2C 3D 4H", new Set()), middle: parseCards("KH KD KC 2H 3D"), back: parseCards("4C 4D 6H 7S 9C") });
  eq(r2.ok ? null : [r2.error, r2.message], ["foul_middle_back", "倒水：中道不能比尾道大"], "倒水：只有中道比尾道大 → 提示「倒水：中道不能比尾道大」");
  const all = [...front, ...middle, ...back];
  const sizes: [string, Arrangement][] = [
    ["頭道 4 張", { front: all.slice(0, 4), middle: all.slice(4, 9), back: all.slice(9, 13) }],
    ["中道 4 張", { front: all.slice(0, 3), middle: all.slice(3, 7), back: all.slice(7, 13) }],
    ["尾道 6 張", { front: all.slice(0, 3), middle: all.slice(3, 7), back: all.slice(7, 13) }],
    ["頭道空", { front: [], middle: middle, back: back }],
  ];
  eq(sizes.map(([n, a]) => { const c = checkArrangement(a); return `${n}:${c.ok ? "ok" : `${c.error}/${c.message}`}`; }), sizes.map(([n]) => `${n}:bad_size/頭道要 3 張、中道和尾道各 5 張`),
    "張數錯（頭道多一張、中道少一張、尾道多一張、頭道空）→ bad_size，提示「頭道要 3 張、中道和尾道各 5 張」");
  const dealt = all;
  const ids = (xs: Card[]) => xs.map((c) => c.id);
  const sub = (o: object) => { const v = validateSubmission(dealt, { front: ids(front), middle: ids(middle), back: ids(back), ...o }); return v.ok ? "ok" : `${v.error}/${v.message}`; };
  eq([
    sub({}), sub({ front: [...ids(front), ids(middle)[0]] }), sub({ middle: ids(middle).slice(0, 4) }), sub({ back: [] }),
    sub({ front: [ids(front)[0], ids(front)[0], ids(front)[2]] }), sub({ back: [...ids(back).slice(0, 4), "HT1"] }),
    (() => { const v = validateSubmission(ids(both.front).concat(ids(both.middle), ids(both.back)).map((id) => [...both.front, ...both.middle, ...both.back].find((c) => c.id === id)!), { front: ids(both.front), middle: ids(both.middle), back: ids(both.back) }); return v.ok ? "ok" : `${v.error}/${v.message}`; })(),
  ], [
    "ok", "bad_size/頭道要 3 張、中道和尾道各 5 張", "bad_size/頭道要 3 張、中道和尾道各 5 張", "bad_size/頭道要 3 張、中道和尾道各 5 張",
    "duplicate_card/同一張牌不能用兩次", "not_your_card/有不是你的牌", "foul_front_middle/倒水：頭道不能比中道大",
  ], "送出檢查逐項：合法通過；頭道多一張、中道少一張、尾道空 → bad_size；同一張送兩次 → duplicate_card；別人的牌 → not_your_card；倒水 → foul_front_middle，各自帶中文提示");
}

// ===== 合法四人牌局工具 =====
function table(rows: [string, string, string][]): Arrangement[] {
  const used = new Set<string>();
  return rows.map(([f, m, b]) => ({ front: parseCards(f, used), middle: parseCards(m, used), back: parseCards(b, used) }));
}
const pairOf = (r: ReturnType<typeof scoreRound>, a: number, b: number) => r.pairs.find((p) => p.a === a && p.b === b)!;

// ===== 【加分牌型平手不加分】【表外牌型不加分】 =====
{
  const t = table([
    ["TC 3D 2C", "AH AD 4C 6S TS", "5H 6H 7H 8H 9H"],   // 0：尾道紅心同花順 5-9
    ["7D 3H 2D", "KH KD 4D 6D 8D", "5C 6C 7C 8C 9C"],   // 1：尾道梅花同花順 5-9（和 0 一樣大）
    ["AS AC 2H", "KS KS QS QS 2S", "JH JD JC 3C 3S"],   // 2：頭道 AA、中道同花兩對、尾道葫蘆（都不在加分表）
    ["KC 4H 5D", "8S 9D TD JS QC", "AS 9S 7S 5S 4S"],   // 3：烏龍、順子、同花
  ]);
  const r = scoreRound(t);
  const p01 = pairOf(r, 0, 1), p23 = pairOf(r, 2, 3);
  eq([p01.rows.back, p01.points, p01.gunner], [{ winner: null, bonus: 0 }, 2, null],
    "加分牌型平手：0、1 尾道都是 5-9 同花順（不同花色）→ 該道平手 0 分、不付同花順 3 分；頭、中 0 贏 → 0 對 1 ＝ +2、不算打槍");
  eq([p23.rows.front, p23.rows.middle, p23.rows.back, p23.gunner, p23.points],
    [{ winner: 2, bonus: 0 }, { winner: 2, bonus: 0 }, { winner: 2, bonus: 0 }, 2, 4],
    "表外牌型不加分：2 的頭道 AA、中道同花兩對、尾道葫蘆三道全贏 3 → 只有 3＋打槍 1 ＝ +4，三道加分都是 0");
  eq(r.totals.reduce((a, b) => a + b, 0), 0, "這局四家總分 0");
}
{
  // 衝三贏下一道：輸家付 2。加分牌型「平手」只可能是同花順（三條、鐵支、五龍要兩家同點數，需要 6～10 張同點，65 張裡每點最多 5 張，不可能發生）
  const t = table([
    ["7H 7D 7S", "2C 3D 4D 5H 6S", "AH KH QH 9H 3H"],      // 0：頭道三條 7、中道順子、尾道同花
    ["7S 2H 2D", "QD QC JD JC 3C", "8C 9D TD JS QS"],      // 1：頭道一對 2
    ["3S 4C JH", "5C 5D 9C 9S KC", "TS TC TH 8H 8D"],      // 2：頭道烏龍
    ["5S 6H 8S", "6C 6D 4H 4S QS", "KS KS 9S 3S 2S"],      // 3：頭道烏龍
  ]);
  const r = scoreRound(t);
  eq([pairOf(r, 0, 1).rows.front, pairOf(r, 0, 2).rows.front, pairOf(r, 0, 3).rows.front], [{ winner: 0, bonus: 2 }, { winner: 0, bonus: 2 }, { winner: 0, bonus: 2 }],
    "衝三：0 的頭道三條 7 贏另外三家，每家多付 2（對照上面同花順平手不付）");
}

// ===== 【一位玩家同時被另外三家打槍】完整合法四家 =====
{
  const t = table([
    ["AH KD QC", "TH TD TC 2D 3H", "4S 5S 6S 8S JS"],   // 0：烏龍 AKQ、三條 T、黑桃同花
    ["AD KH QD", "JH JD JC 2H 3C", "7H 8H 9H TS JS"],   // 1：烏龍 AKQ、三條 J、順子 J
    ["AC KC QH", "QS QS 2S 3S 4D", "KS KS 5H 5S 6H"],   // 2：烏龍 AKQ、一對 Q、兩對 KK55
    ["2C 3D 4H", "5C 5D 7D 8C 9C", "6C 6D 7C 9D 9S"],   // 3：烏龍 432、一對 55、兩對 9966
  ]);
  const r = scoreRound(t);
  const vs3 = [0, 1, 2].map((s) => { const p = pairOf(r, s, 3); return [p.gunner, p.points, ...["front", "middle", "back"].map((k) => p.rows[k as "front"].bonus)]; });
  eq(vs3, [[0, 4, 0, 0, 0], [1, 4, 0, 0, 0], [2, 4, 0, 0, 0]],
    "被三家打槍：0、1、2 都三道全贏 3 → 每家都是打槍者，各拿 3＋1＝4（沒有加分）");
  eq([r.totals, r.homeRun, r.totals.reduce((a, b) => a + b, 0)], [[6, 6, 0, -12], null, 0],
    "被三家打槍的完整四家：3 付 12 ＝ 三道 3×3 ＋ 打槍 1×3（打槍共多付 3 分）；0 對 1 平、0 對 2 +2、1 對 2 +2 → +6／+6／0／−12，沒有全壘打，合計 0");
}

// ===== 【特殊牌型第一版不做】一條龍照一般三道算 =====
{
  const t = table([
    ["2C 3D 4H", "5C 6D 7H 8S 9C", "TD JH QS KC AD"],   // 0：一條龍（2～A 各一張），只當烏龍、順子 9、順子 A
    ["AH AS KH", "2D 2H 3C 3S 4D", "QH QD QC 5D 5H"],   // 1：一對 A、兩對、葫蘆
    ["KD 9D 6C", "TH TC JD JC 8D", "KS KS 9S 7S 2S"],
    ["6H 7C 8C", "4C 4S 9H 9S 3H", "AS 5S 6S 7S TS"],
  ]);
  const r = scoreRound(t);
  const p = pairOf(r, 0, 1);
  eq([p.rows.front.winner, p.rows.middle.winner, p.rows.back.winner, p.points], [1, 0, 1, -1],
    "特殊牌型第一版不做：0 拿到一條龍（2～A），照一般三道比：頭道輸、中道（順子）贏、尾道（順子對葫蘆）輸 → −1，沒有額外的特殊牌型分");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

// 十三支 v4 規則（老闆 2026-11-19 定案；取代沒上線的 v3）：
//   ・彩金牌＝65 張發完剩下的 1 張；點數跟它一樣的牌叫彩金點數。彩金衝三（頭墩三張）、彩金葫蘆（三張那組）、彩金鐵支（四張）
//   ・黑桃同花順＝五張全是黑桃的同花順；其他花色是非黑桃同花順
//   ・大小：五龍 > 彩金鐵支 > 非黑桃同花順 > 黑桃同花順 > 鐵支 > 彩金葫蘆 > 葫蘆 > …；同一種牌型裡彩金最大（黑桃同花順大於鐵支：老闆 2026-11-23）
//   ・計分：一道的輸贏本身不算分；特殊牌型加分只向「那一道被你贏過的人」收；打槍 1；全壘打再向每家收 2
//   V1 牌型判斷（v4 有彩金點數／沒有彩金牌、舊規則）
//   V2 大小排序
//   V3 每種特殊牌型在各墩向被贏過的人收的數字；一般牌型贏了 0
//   V4 四家：只向被贏過的人收（贏一家收、輸給別人照付別人的）
//   V5 全壘打：贏家 +9、三家各 −3（未乘底分）；左欄明細 rows 0、打槍 3、全壘打 6
//   V6 彩金 5 衝三贏 6 衝三
//   V7 舊規則房（v1、jia）結果不變
//   V8 倒水照各自的規則
//   V9 推薦排法（逾時代排）照新規則：隨機 300 副（彩金牌照真的發牌）都不倒水；有彩金鐵支的手牌會排出彩金鐵支
//   V10 顯示順序 A、2、3…K
import { deal, makeCard, sortCards, type Card } from "../lib/thirteen/cards";
import { CAT, CAT_NAME, compareValue, evalFive, evalThree, type HandRule } from "../lib/thirteen/hand";
import { autoArrange, checkArrangement } from "../lib/thirteen/arrange";
import { bonusOf, scoreRound, type ScoreRule } from "../lib/thirteen/score";
import { handStats } from "../lib/thirteen/flow";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const R: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
let n = 0;
const c = (s: string): Card => makeCard(s[0] as Card["suit"], R[s.slice(1)] ?? Number(s.slice(1)), (n++ % 2 + 1) as 1 | 2);
const cards = (s: string) => s.split(" ").map(c);
const hand = (f: string, m: string, b: string) => ({ front: cards(f), middle: cards(m), back: cards(b) });
type H = ReturnType<typeof hand>;
const L5: HandRule = { lucky: 5 }, NOL: HandRule = { lucky: null };
/** 座位 0 對座位 1 的分數（另外兩家照抄座位 1） */
const pair01 = (p0: H, p1: H, rule: ScoreRule, lucky: number | null = null) =>
  scoreRound([p0, p1, p1, p1], rule, lucky).pairs.find((p) => p.a === 0 && p.b === 1)!.points;

// V1
{
  const f = (s: string, r: HandRule) => evalFive(cards(s), r).cat;
  eq([f("S5 S6 S7 S8 S9", NOL), f("S5 S6 S7 S8 S9", "legacy"), f("H5 H6 H7 H8 H9", NOL),
    f("C5 D5 H5 S5 C2", L5), f("C5 D5 H5 S5 C2", NOL), f("C5 D5 H5 S5 C2", "legacy"),
    f("C5 D5 H5 C9 D9", L5), f("C9 D9 H9 C5 D5", L5), f("C5 D5 H5 C9 D9", "legacy"),
    evalThree(cards("C5 D5 H5"), L5).cat, evalThree(cards("C5 D5 H5"), "legacy").cat, evalThree(cards("C6 D6 H6"), L5).cat, evalFive(cards("S5 S6 S7 S8 S9")).cat,
    [12, 13, 14, 15].map((k) => CAT_NAME[k])],
    [12, 10, 10, 15, 9, 9, 14, 8, 8, 13, 3, 3, 12, ["黑桃同花順", "彩金三條", "彩金葫蘆", "彩金鐵支"]],
    "V1 牌型：黑桃同花順 12（舊規則照舊 10）；彩金 5 時 5555 是彩金鐵支 15、555+99 彩金葫蘆 14、999+55 只是葫蘆、頭墩 555 彩金三條 13；沒有彩金牌或舊規則都沒有彩金牌型；沒指定規則＝v4");
}
// V2
{
  const v = (s: string) => evalFive(cards(s), L5);
  const order = [v("CK DK HK SK SK"), v("C5 D5 H5 S5 C2"), v("H2 H3 H4 H5 H6"), v("S9 ST SJ SQ SK"), v("CA DA HA SA C3"), v("C5 D5 H5 C2 D2"), v("CA DA HA CK DK")];
  const names = ["五龍", "彩金鐵支", "非黑桃同花順", "黑桃同花順", "鐵支", "彩金葫蘆", "葫蘆"];
  const desc = order.slice(1).map((x, i) => compareValue(order[i], x) > 0);
  const t = (s: string) => evalThree(cards(s), { lucky: 2 });
  eq([order.map((x) => x.cat), desc, compareValue(t("C2 D2 H2"), t("CA DA HA")) > 0, compareValue(evalFive(cards("C2 D2 H2 S7 D9"), { lucky: 2 }), evalFive(cards("CA DA HA S7 D9"), { lucky: 2 })) > 0],
    [[11, 15, 10, 12, 9, 14, 8], [true, true, true, true, true, true], true, true],
    `V2 大小：${names.join(" > ")}（最小的彩金鐵支贏 A 的鐵支、K 的黑桃同花順贏 A 的鐵支、最小的彩金葫蘆贏 A 的葫蘆）；彩金 2 的三條贏 A 的三條`);
}
// V3
const LOW_FRONT = "C2 D3 H7", MID = "C4 D5 H6 S7 C8", BACK = "C9 DT HJ SQ CK", FIVE_A = "CA DA HA SA SA";
{
  const cases: [string, number, H, H][] = [
    ["頭墩衝三", 1, hand("C9 D9 H9", MID, FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["頭墩彩金衝三", 2, hand("C5 D5 H5", "C9 DT HJ SQ CK", FIVE_A), hand(LOW_FRONT, "C9 DT HJ SQ CK", FIVE_A)],
    ["中墩彩金葫蘆", 1, hand(LOW_FRONT, "C5 D5 H5 C9 D9", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["中墩黑桃同花順", 2, hand(LOW_FRONT, "S9 ST SJ SQ SK", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["中墩鐵支", 2, hand(LOW_FRONT, "C7 D7 H7 S7 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["中墩非黑桃同花順", 3, hand(LOW_FRONT, "H4 H5 H6 H7 H8", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["中墩彩金鐵支", 6, hand(LOW_FRONT, "C5 D5 H5 S5 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["中墩五龍", 10, hand(LOW_FRONT, "CK DK HK SK SK", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["尾墩彩金葫蘆", 0, hand(LOW_FRONT, MID, "C5 D5 H5 C9 D9"), hand(LOW_FRONT, MID, "CA DA HA CK DK")],
    ["尾墩黑桃同花順", 1, hand(LOW_FRONT, MID, "S9 ST SJ SQ SK"), hand(LOW_FRONT, MID, BACK)],
    ["尾墩鐵支", 1, hand(LOW_FRONT, MID, "C9 D9 H9 S9 C3"), hand(LOW_FRONT, MID, BACK)],
    ["尾墩非黑桃同花順", 2, hand(LOW_FRONT, MID, "H9 HT HJ HQ HK"), hand(LOW_FRONT, MID, BACK)],
    ["尾墩彩金鐵支", 3, hand(LOW_FRONT, MID, "C5 D5 H5 S5 C3"), hand(LOW_FRONT, MID, BACK)],
    ["尾墩五龍", 5, hand(LOW_FRONT, MID, FIVE_A), hand(LOW_FRONT, MID, BACK)],
    ["中墩葫蘆贏順子（一般牌型）", 0, hand(LOW_FRONT, "C7 D7 H7 S2 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
    ["頭墩 A 對贏 K 對（一般牌型）", 0, hand("CA DA H5", MID, FIVE_A), hand("CK DK H5", MID, FIVE_A)],
  ];
  eq(cases.map(([name, , p0, p1]) => [name, pair01(p0, p1, "v4", 5)]), cases.map(([name, want]) => [name, want]),
    "V3 v4（彩金 5）那一道贏一家收：衝三 1、彩金衝三 2；中墩 彩金葫蘆 1、黑桃同花順 2、鐵支 2、非黑桃同花順 3、彩金鐵支 6、五龍 10；尾墩 彩金葫蘆 0、黑桃同花順 1、鐵支 1、非黑桃同花順 2、彩金鐵支 3、五龍 5；一般牌型贏了 0");
  eq([bonusOf("middle", evalFive(cards("C5 D5 H5 S5 C2"), L5)), bonusOf("back", evalFive(cards("C5 D5 H5 C9 D9"), L5)), bonusOf("front", evalThree(cards("C5 D5 H5"), L5))], [6, 0, 2],
    "V3 bonusOf 沒指定規則＝v4：中墩彩金鐵支 6、尾墩彩金葫蘆 0、頭墩彩金衝三 2");
}
// V4
{
  const arr = [hand(LOW_FRONT, "C7 D7 H7 S7 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A), hand(LOW_FRONT, "H4 H5 H6 H7 H8", FIVE_A), hand(LOW_FRONT, "C9 D9 H9 S9 C3", FIVE_A)];
  const r = scoreRound(arr, "v4");
  const st = handStats(r, "v4");
  eq([r.totals, st.map((x) => x.bonuses), st.map((x) => x.rows)],
    [[-3, -7, 9, 1], [[{ name: "中墩同花順", points: -3 }], [{ name: "中墩鐵支", points: -4 }, { name: "中墩同花順", points: -3 }], [{ name: "中墩同花順", points: 9 }], [{ name: "中墩鐵支", points: 4 }, { name: "中墩同花順", points: -3 }]], [0, 0, 0, 0]],
    "V4 四家中墩：0 號鐵支 7 只贏 1 號 → 收 1 號 2、付 2 號同花順 3、付 3 號鐵支 9 的 2＝−3（同名的鐵支 +2、−2 合併成 0 不列）；1 號 −7；2 號同花順贏三家 +9；3 號鐵支收兩家 +4、付同花順 3＝+1；沒有墩分");
}
// V5
{
  const shooter = hand("C9 D9 H5", "C5 D6 H7 S8 C9", "CT DJ HQ SK CA"), victim = hand(LOW_FRONT, MID, BACK);
  const arr = [shooter, victim, victim, victim];
  const r = scoreRound(arr, "v4");
  const st = handStats(r, "v4");
  eq([r.totals, r.homeRun, st.map((x) => [x.rows, x.gunPoints, x.homeRunPoints, x.total])],
    [[9, -3, -3, -3], 0, [[0, 3, 6, 9], [0, -1, -2, -3], [0, -1, -2, -3], [0, -1, -2, -3]]],
    "V5 全壘打（三道都是一般牌型）：贏家 +9（三槍 3＋全壘打 6）、三家各 −3；左欄 rows 0、打槍、全壘打照拆");
}
// V6
{
  const p0 = hand("C5 D5 H5", "C9 DT HJ SQ CK", FIVE_A), p1 = hand("C6 D6 H6", "C9 DT HJ SQ CK", FIVE_A);
  eq([pair01(p0, p1, "v4", 5), pair01(p0, p1, "v4", null), pair01(p0, p1, "jia")], [2, -1, -2],
    "V6 彩金 5：5 衝三贏 6 衝三，收 2（彩金衝三）；沒有彩金牌時 6 衝三贏、收 1；jia 房照舊 6 衝三贏 2");
}
// V7
{
  const spade = hand(LOW_FRONT, "S5 S6 S7 S8 S9", FIVE_A), four = hand(LOW_FRONT, "C7 D7 H7 S7 C2", FIVE_A), luckyFour = hand(LOW_FRONT, "C5 D5 H5 S5 C2", FIVE_A), low = hand(LOW_FRONT, MID, FIVE_A);
  const shooter = hand("C9 D9 H5", "C5 D6 H7 S8 C9", "CT DJ HQ SK CA"), victim = hand(LOW_FRONT, MID, BACK);
  const run = (rule: ScoreRule) => [pair01(spade, low, rule, 5), pair01(four, low, rule, 5), pair01(luckyFour, low, rule, 5), scoreRound([shooter, victim, victim, victim], rule, 5).totals];
  eq([run("v1"), run("jia")], [[7, 5, 5, [21, -7, -7, -7]], [6, 4, 4, [21, -7, -7, -7]]],
    "V7 舊規則房不變：中墩黑桃同花順＝同花順（v1 7、jia 6）、中墩鐵支 v1 5／jia 4、四張彩金點數只是鐵支；全壘打 +21／−7（每道 1 墩、打槍 1、全壘打 3）");
}
// V8
{
  const r = (x: ReturnType<typeof checkArrangement>) => (x.ok ? "ok" : x.error);
  const a = hand(LOW_FRONT, "S5 S6 S7 S8 S9", "C9 D9 H9 S9 C3");     // 中黑桃同花順、尾鐵支
  const b = hand(LOW_FRONT, "CA DA HA CK DK", "C2 D2 H2 C3 D3");     // 中 A 葫蘆、尾彩金 2 葫蘆
  const d = hand("C2 D2 H2", "C6 D6 H6 S9 DT", "CA DA HA SA C3");     // 頭彩金 2 三條、中 6 三條
  const L2: HandRule = { lucky: 2 };
  eq([r(checkArrangement(a, NOL)), r(checkArrangement(a, "legacy")), r(checkArrangement(b, L2)), r(checkArrangement(b, "legacy")), r(checkArrangement(d, L2)), r(checkArrangement(d, "legacy"))],
    ["foul_middle_back", "foul_middle_back", "ok", "foul_middle_back", "foul_front_middle", "ok"],
    "V8 倒水：中黑桃同花順＋尾鐵支 v4、舊規則都倒水（黑桃同花順大於鐵支）；中 A 葫蘆＋尾彩金葫蘆 v4 合法、舊規則倒水；頭彩金三條比中墩一般三條大 → v4 倒水");
}
// V9
{
  let bad = 0, badLegacy = 0;
  for (let i = 0; i < 300; i++) {
    const d = deal();
    const rule: HandRule = { lucky: d.rest[0].rank };
    const h = d.hands[i % 4];
    if (!checkArrangement(autoArrange(h, rule), rule).ok) bad++;
    if (!checkArrangement(autoArrange(h, "legacy"), "legacy").ok) badLegacy++;
  }
  const forced = cards("C5 D5 H5 S5 C9 DT HJ SQ CK H2 D3 C4 S7 D8 HQ CA");
  const fa = autoArrange(forced, L5);
  const cats = [evalThree(fa.front, L5).cat, evalFive(fa.middle, L5).cat, evalFive(fa.back, L5).cat];
  eq([bad, badLegacy, checkArrangement(fa, L5).ok, cats.includes(CAT.LUCKY_FOUR)], [0, 0, true, true],
    "V9 推薦排法：隨機 300 副（彩金牌是真的剩下那張）v4、舊規則各自都不倒水；手上有四張彩金 5 時排得出彩金鐵支");
}
// V10
{
  eq(sortCards(cards("S5 SA H4 D3 C2 SK HA")).map((x) => x.id.slice(0, 2)), ["SA", "HA", "C2", "D3", "H4", "S5", "SK"],
    "V10 顯示順序：A、2、3…K（同點數黑桃、紅心、方塊、梅花）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

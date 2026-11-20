// 十三支彩金新規則（老闆 2026-11-20 定案；和打槍 v5 同一個版本 scoreRule "v5"，v4 以前的房不變）：
//   ・彩金分：任何一墩擺 3 張以上彩金點數，不管那墩輸贏，向另外三家各收 1（+3、三家各 −1）
//   ・特殊牌型只向那一墩被贏過的人收、每贏一家收一次：頭墩彩金衝三照衝三 +1；中墩彩金三條 0、彩金葫蘆 +1、彩金鐵支 +9；
//     尾墩彩金三條 0、彩金葫蘆 0、彩金鐵支 +4；其他牌型照 v4；牌型大小不變
//   K1 中墩彩金鐵支贏三家（其他墩沒贏、不打槍）：+30、三家各 −10；左欄明細「彩金分」+3、三家各 −1
//   K2 中墩彩金鐵支贏兩家、輸一家：中墩從兩家收 9×2＝18，彩金分 +3；全部和獨立參考值一樣，四家總和 0
//   K3 擺 3 張彩金點數的那一墩輸了（中墩彩金三條輸給順子），照樣拿彩金分 +3；頭墩彩金衝三一定是頭墩最大，贏每家 +1＋彩金分 3
//   K4 v5 加分表：上面每一種；彩金分只算 3 張以上（2 張不算）；沒有彩金牌時沒有彩金分
//   K5 同一副牌在 v4 房：照 v4（中墩彩金鐵支每家 6、沒有彩金分）
//   K6 隨機 3000 局（真的發牌、推薦排法、彩金牌）：v5 和獨立參考值一樣、四家總和都是 0；左欄明細各項加起來等於這局總分
import { deal, makeCard, type Card } from "../lib/thirteen/cards";
import { autoArrange } from "../lib/thirteen/arrange";
import { CAT, compareValue, evalFive, evalThree, type HandValue } from "../lib/thirteen/hand";
import { bonusOf, handRuleOf, homeRunPenaltyOf, rowPoints, ROWS, scoreRound, SCORING, type RoundResult, type Row, type ScoreRule } from "../lib/thirteen/score";
import { handStats } from "../lib/thirteen/flow";
import type { Arrangement } from "../lib/thirteen/arrange";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const R: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
let n = 0;
const c = (s: string): Card => makeCard(s[0] as Card["suit"], R[s.slice(1)] ?? Number(s.slice(1)), (n++ % 2 + 1) as 1 | 2);
const cards = (s: string) => s.split(" ").map(c);
const hand = (f: string, m: string, b: string): Arrangement => ({ front: cards(f), middle: cards(m), back: cards(b) });
const L = 5; // 這一局的彩金點數
const st = (r: RoundResult, rule: ScoreRule) => handStats(r, rule);
const luckyOf = (s: { luckyPoints?: number }) => s.luckyPoints ?? 0;

// 對手：頭墩 9-7-4、中墩一對 3、尾墩五龍 3（和 P0 的尾墩平手）
const P1 = hand("S9 D7 H4", "C3 D3 H8 S6 CJ", "C3 D3 H3 S3 S3");
// K1
{
  const P0 = hand("C2 D3 H4", "C5 D5 H5 S5 C9", "C3 D3 H3 S3 S3"); // 頭墩一對 2 輸、中墩彩金鐵支贏、尾墩平手
  const r = scoreRound([P0, P1, P1, P1], "v5", L), s = st(r, "v5");
  eq([r.totals, r.pairs.filter((p) => p.gunner !== null).length, s.map(luckyOf), s[0].bonuses], [[30, -10, -10, -10], 0, [3, -1, -1, -1], [{ name: "中墩彩金鐵支", points: 27 }]],
    "K1 中墩彩金鐵支贏三家：+30、三家各 −10（9×3＋彩金分 3）；沒有打槍（頭墩輸）；左欄彩金分 +3、三家各 −1，中墩彩金鐵支 +27");
}
// K2
{
  const P0 = hand("C2 D3 H4", "C5 D5 H5 S5 C9", "C3 D3 H3 S3 S3");
  const X = hand("S9 D7 H4", "C7 D7 H7 S7 S7", "CK DK HK SK SK"); // 中墩五龍贏 P0、尾墩五龍 K
  const r = scoreRound([P0, P1, P1, X], "v5", L), s = st(r, "v5");
  const fromMid = r.pairs.filter((p) => p.rows.middle.winner === 0).reduce((t, p) => t + p.rows.middle.bonus, 0);
  eq([fromMid, luckyOf(s[0]), r.totals.reduce((a, b) => a + b, 0)], [18, 3, 0], "K2 中墩彩金鐵支贏兩家輸一家：中墩從兩家收 9×2＝18、彩金分 +3，四家總和 0");
  // 0 號總分＝18＋3 − 輸給 X 的：中墩五龍 10、尾墩五龍 K 5、X 三墩全贏被打槍 1；X 對 1、2 號也沒輸任何一墩（v5 打槍）→ 全壘打再付 2
  //   ＝ 3（頭墩輸 P1 一般牌型 0 分、尾墩和 P1 平手）
  eq([r.homeRun, r.totals[0]], [3, 18 + 3 - 10 - 5 - 1 - 2], "K2 中墩彩金鐵支贏兩家輸一家：0 號總分＝18＋3 − 輸的那幾墩（五龍 10＋五龍 5）− 被打槍 1 − X 全壘打 2 ＝ 3");
}
// K3
{
  const P0 = hand("C2 D2 H4", "C5 D5 H5 C9 DJ", "C3 D3 H3 S3 S3");            // 頭墩一對 2 贏、中墩彩金三條輸、尾墩平手（雙方都沒打槍）
  const Y = hand("S9 D7 H4", "C6 D7 H8 S9 CT", "C3 D3 H3 S3 S3");              // 中墩順子
  const r = scoreRound([P0, Y, Y, Y], "v5", L), s = st(r, "v5");
  eq([r.pairs.filter((p) => p.a === 0).map((p) => p.rows.middle.winner), luckyOf(s[0]), r.totals], [[1, 2, 3], 3, [3, -1, -1, -1]],
    "K3 中墩彩金三條輸給三家的順子（加分 0），照樣拿彩金分：+3、三家各 −1");
  const F = hand("C5 D5 H5", "C6 D7 H8 S9 CT", "C3 D3 H3 S3 S3");              // 頭墩彩金衝三
  const r2 = scoreRound([F, P1, P1, P1], "v5", L), s2 = st(r2, "v5");
  eq([r2.pairs.filter((p) => p.a === 0).map((p) => [p.rows.front.winner, p.rows.front.bonus]), luckyOf(s2[0]), s2[0].bonuses],
    [[[0, 1], [0, 1], [0, 1]], 3, [{ name: "彩金衝三", points: 3 }]], "K3 頭墩彩金衝三（頭墩最大）贏三家：每家照衝三 +1，另外彩金分 +3");
}
// K4
{
  const v = (row: Row, s: string) => (row === "front" ? evalThree(cards(s), { lucky: L }) : evalFive(cards(s), { lucky: L }));
  const b = (row: Row, s: string) => bonusOf(row, v(row, s), "v5");
  eq([b("front", "C5 D5 H5"), b("front", "C6 D6 H6"), b("middle", "C5 D5 H5 C9 DJ"), b("middle", "C5 D5 H5 C9 D9"), b("middle", "C5 D5 H5 S5 C9"),
    b("back", "C5 D5 H5 C9 DJ"), b("back", "C5 D5 H5 C9 D9"), b("back", "C5 D5 H5 S5 C9"), b("middle", "C6 D6 H6 S6 C9"), b("back", "C6 D6 H6 S6 C9"), b("middle", "C6 D6 H6 S6 S6")],
    [1, 1, 0, 1, 9, 0, 0, 4, 2, 1, 10], "K4 v5 加分表：頭墩彩金衝三 1、衝三 1；中墩彩金三條 0、彩金葫蘆 1、彩金鐵支 9；尾墩彩金三條 0、彩金葫蘆 0、彩金鐵支 4；一般鐵支、五龍照 v4");
  const two = hand("C2 D3 H4", "C5 D5 H8 C9 DJ", "C3 D3 H3 S3 S3");             // 中墩只有 2 張彩金點數
  const P0 = hand("C2 D3 H4", "C5 D5 H5 S5 C9", "C3 D3 H3 S3 S3");
  eq([st(scoreRound([two, P1, P1, P1], "v5", L), "v5").map(luckyOf), st(scoreRound([P0, P1, P1, P1], "v5", null), "v5").map(luckyOf)], [[0, 0, 0, 0], [0, 0, 0, 0]],
    "K4 只有 2 張彩金點數不算彩金分；沒有彩金牌（lucky null）就沒有彩金分");
}
// K5
{
  const P0 = hand("C2 D3 H4", "C5 D5 H5 S5 C9", "C3 D3 H3 S3 S3");
  const r = scoreRound([P0, P1, P1, P1], "v4", L), s = st(r, "v4");
  eq([r.totals, s.map(luckyOf), bonusOf("middle", evalFive(cards("C5 D5 H5 S5 C9"), { lucky: L }), "v4")], [[18, -6, -6, -6], [0, 0, 0, 0], 6],
    "K5 同一副牌在 v4 房：中墩彩金鐵支每家 6（共 +18、三家各 −6），沒有彩金分");
}
// K6
{
  const BONUS_V5: Record<Row, Partial<Record<number, number>>> = {
    front: { [CAT.THREE_KIND]: 1, [CAT.LUCKY_THREE]: 1 },
    middle: { [CAT.LUCKY_THREE]: 0, [CAT.LUCKY_FULL_HOUSE]: 1, [CAT.SPADE_STRAIGHT_FLUSH]: 2, [CAT.FOUR_KIND]: 2, [CAT.STRAIGHT_FLUSH]: 3, [CAT.LUCKY_FOUR]: 9, [CAT.FIVE_KIND]: 10 },
    back: { [CAT.LUCKY_THREE]: 0, [CAT.LUCKY_FULL_HOUSE]: 0, [CAT.SPADE_STRAIGHT_FLUSH]: 1, [CAT.FOUR_KIND]: 1, [CAT.STRAIGHT_FLUSH]: 2, [CAT.LUCKY_FOUR]: 4, [CAT.FIVE_KIND]: 5 },
  };
  function reference(arrs: Arrangement[], vals: Record<Row, HandValue>[], lucky: number): number[] {
    const totals = [0, 0, 0, 0], guns = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      let aw = 0, bw = 0, pts = 0;
      for (const row of ROWS) {
        const cmp = compareValue(vals[a][row], vals[b][row]);
        if (cmp > 0) { aw++; pts += BONUS_V5[row][vals[a][row].cat] ?? 0; }
        if (cmp < 0) { bw++; pts -= BONUS_V5[row][vals[b][row].cat] ?? 0; }
      }
      if (bw === 0 && aw >= 1) { pts += 1; guns[a]++; }
      if (aw === 0 && bw >= 1) { pts -= 1; guns[b]++; }
      totals[a] += pts; totals[b] -= pts;
    }
    const hr = guns.indexOf(3);
    if (hr >= 0) for (let s = 0; s < 4; s++) if (s !== hr) { totals[s] -= 2; totals[hr] += 2; }
    for (let s = 0; s < 4; s++) for (const row of ROWS) if (arrs[s][row].filter((x) => x.rank === lucky).length >= 3)
      for (let o = 0; o < 4; o++) if (o !== s) { totals[o] -= 1; totals[s] += 1; }
    return totals;
  }
  let seed = 11;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let mismatch = 0, nonZero = 0, statsOff = 0, luckyHands = 0;
  for (let i = 0; i < 3000; i++) {
    const { hands, rest } = deal(rng);
    const lucky = rest[0].rank;
    const arrs = hands.map((h) => autoArrange(h, handRuleOf("v5", lucky)));
    const r = scoreRound(arrs, "v5", lucky);
    if (JSON.stringify(r.totals) !== JSON.stringify(reference(arrs, r.values, lucky))) mismatch++;
    if (r.totals.reduce((a, b) => a + b, 0) !== 0) nonZero++;
    const s = st(r, "v5");
    if (s.some((x, seat) => x.rows + x.bonuses.reduce((t, b) => t + b.points, 0) + x.gunPoints + x.homeRunPoints + luckyOf(x) !== r.totals[seat])) statsOff++;
    if (s.some((x) => luckyOf(x) > 0)) luckyHands++;
  }
  eq([mismatch, nonZero, statsOff, luckyHands > 0], [0, 0, 0, true], `K6 隨機 3000 局：和獨立參考值一樣、四家總和都是 0、左欄明細各項加起來等於總分（有彩金分的局 ${luckyHands} 局）`);
  void homeRunPenaltyOf; void rowPoints; void SCORING;
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

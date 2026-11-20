// 十三支打槍規則 v5（老闆 2026-11-20 定案）：對某一家來說，三墩裡沒有任何一墩輸給他、而且至少贏一墩，就算打槍他（平手的墩不影響）。
// 其他計分（牌型、特殊牌型加分、打槍每家 +1、全壘打再向每家 +2）都和 v4 一樣；新開的房記 scoreRule "v5"，v4／jia／舊房整場照原規則。
//   G1 老闆的例子：頭墩平手、中墩贏、尾墩贏＝打槍；頭墩贏、中墩平手、尾墩平手＝打槍
//   G2 三墩全平不算；有任何一墩輸不算（就算另外兩墩贏）
//   G3 v4 同樣的牌：只有三墩全贏才算打槍（G1 兩個例子在 v4 都不算）
//   G4 新規則的全壘打：靠平手墩打槍三家也算全壘打，贏家 +9、三家各 −3（未乘底分）；左欄明細打槍 3、全壘打 6
//   G5 隨機 3000 局（真的發牌、推薦排法、彩金牌）：v4、v5 各自和獨立算的參考值一模一樣；四家總和都是 0；v5 打槍數 ≥ v4
//   G6 規則版本：scoreRuleOf 認得 "v5"；v5 的房有彩金牌、牌型和加分表照 v4
//   G7 伺服器真的亮牌（revealIfReady）：v5 房照新規則存打槍、左欄明細、乘底分、整場累計；亮牌動畫長度多算 3 槍＋全壘打；同一副牌的 v4 房照舊規則
import { deal, makeCard, type Card } from "../lib/thirteen/cards";
import { autoArrange } from "../lib/thirteen/arrange";
import { compareValue, type HandValue } from "../lib/thirteen/hand";
import { bonusOf, handRuleOf, homeRunPenaltyOf, rowPoints, ROWS, scoreRound, SCORING, type RoundResult, type Row, type ScoreRule } from "../lib/thirteen/score";
import { handStats, luckyCardOf, matchStats, revealIfReady, REVEAL_TIMING, scoreRuleOf } from "../lib/thirteen/flow";
import type { ThirteenGameState } from "../lib/thirteen/db";

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
const pairOf = (r: RoundResult, a: number, b: number) => r.pairs.find((p) => p.a === a && p.b === b)!;

// 對手（座位 1～3 都用這副）：頭墩 9-7-4、中墩一對 3、尾墩兩對 6／5
const P1 = hand("S9 D7 H4", "C3 D3 H8 S6 CJ", "C5 D5 H6 S6 CQ");
const ex1 = hand("H9 C7 S4", "C4 D4 H8 S6 CJ", "C7 D7 H8 S8 CQ");   // 頭墩平手、中墩贏、尾墩贏
const ex2 = hand("SA D7 H4", "H3 S3 C8 D6 DJ", "H5 S5 C6 D6 DQ");   // 頭墩贏、中墩平手、尾墩平手
const tie = hand("H9 C7 D4", "H3 S3 D8 C6 HJ", "H5 S5 D6 C6 HQ");   // 三墩全平
const lose1 = hand("S8 D7 H4", "C4 D4 H8 S6 CJ", "C7 D7 H8 S8 CQ"); // 頭墩輸、中墩贏、尾墩贏
const rowsOf = (r: RoundResult) => ROWS.map((row) => pairOf(r, 0, 1).rows[row].winner);
const g = (p0: H, rule: ScoreRule) => { const r = scoreRound([p0, P1, P1, P1], rule); return { gunner: pairOf(r, 0, 1).gunner, points: pairOf(r, 0, 1).points, rows: rowsOf(r), r }; };

// G1
{
  const a = g(ex1, "v5"), b = g(ex2, "v5");
  eq([a.rows, a.gunner, a.points, b.rows, b.gunner, b.points], [[null, 0, 0], 0, 1, [0, null, null], 0, 1],
    "G1 頭墩平手、中墩贏、尾墩贏＝打槍（+1）；頭墩贏、中墩平手、尾墩平手＝打槍（+1）");
}
// G2
{
  const t = g(tie, "v5"), l = g(lose1, "v5");
  eq([t.rows, t.gunner, t.points, l.rows, l.gunner, l.points], [[null, null, null], null, 0, [1, 0, 0], null, 0], "G2 三墩全平不算打槍；頭墩輸、另外兩墩贏也不算");
}
// G3
{
  const a = g(ex1, "v4"), b = g(ex2, "v4"), full = g(hand("SA D7 H4", "C4 D4 H8 S6 CJ", "C7 D7 H8 S8 CQ"), "v4"), full5 = g(hand("SA D7 H4", "C4 D4 H8 S6 CJ", "C7 D7 H8 S8 CQ"), "v5");
  eq([a.gunner, a.points, b.gunner, b.points, full.gunner, full.points, full5.gunner, full5.points], [null, 0, null, 0, 0, 1, 0, 1],
    "G3 v4 只有三墩全贏才算：G1 兩個例子在 v4 都不算（0 分）；三墩全贏 v4、v5 都算 +1");
}
// G4
{
  const r = g(ex1, "v5").r, st = handStats(r, "v5");
  eq([r.homeRun, r.totals, r.totals.reduce((x, y) => x + y, 0), [st[0].guns, st[0].gunPoints, st[0].homeRunPoints], st.slice(1).map((s) => [s.gunned, s.gunPoints, s.homeRunPoints])],
    [0, [9, -3, -3, -3], 0, [3, 3, 6], [[1, -1, -2], [1, -1, -2], [1, -1, -2]]],
    "G4 靠平手墩打槍三家＝全壘打：贏家 +9、三家各 −3，總和 0；左欄明細贏家打槍 3、全壘打 6，三家各被打槍 −1、全壘打 −2");
  const v4 = g(ex1, "v4").r;
  eq([v4.homeRun, v4.totals], [null, [0, 0, 0, 0]], "G4 同一副牌在 v4：沒有打槍、沒有全壘打，四家都 0");
}
// G5
{
  /** 獨立算的參考值：每道贏的人收 rowPoints(bonus)，打槍照規則判定 +1，打槍三家再收全壘打分；v5 再加彩金分（一道 3 張以上彩金點數，另外三家各付 1；2026-11-20 彩金新規則） */
  function reference(vals: Record<Row, HandValue>[], rule: ScoreRule, arrs: { front: Card[]; middle: Card[]; back: Card[] }[] = [], lucky: number | null = null): { totals: number[]; guns: number } {
    const totals = [0, 0, 0, 0], gunsBy = [0, 0, 0, 0];
    let guns = 0;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      let aw = 0, bw = 0, pts = 0;
      for (const row of ROWS) {
        const cmp = compareValue(vals[a][row], vals[b][row]);
        if (cmp > 0) { aw++; pts += rowPoints(bonusOf(row, vals[a][row], rule), rule); }
        if (cmp < 0) { bw++; pts -= rowPoints(bonusOf(row, vals[b][row], rule), rule); }
      }
      const aGun = rule === "v5" ? bw === 0 && aw >= 1 : aw === 3, bGun = rule === "v5" ? aw === 0 && bw >= 1 : bw === 3;
      if (aGun) { pts += SCORING.GUN_PENALTY; gunsBy[a]++; guns++; }
      if (bGun) { pts -= SCORING.GUN_PENALTY; gunsBy[b]++; guns++; }
      totals[a] += pts; totals[b] -= pts;
    }
    const hr = gunsBy.indexOf(3);
    if (hr >= 0) for (let s = 0; s < 4; s++) if (s !== hr) { totals[s] -= homeRunPenaltyOf(rule); totals[hr] += homeRunPenaltyOf(rule); }
    if (rule === "v5" && lucky !== null) for (let s = 0; s < 4; s++) for (const row of ROWS) if (arrs[s][row].filter((x) => x.rank === lucky).length >= 3)
      for (let o = 0; o < 4; o++) if (o !== s) { totals[o] -= 1; totals[s] += 1; }
    return { totals, guns };
  }
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let mismatch = 0, nonZero = 0, fewer = 0, g4 = 0, g5 = 0, homeRuns5 = 0;
  for (let i = 0; i < 3000; i++) {
    const { hands, rest } = deal(rng);
    const lucky = rest[0].rank;
    const arrs = hands.map((h) => autoArrange(h, handRuleOf("v5", lucky)));
    const r4 = scoreRound(arrs, "v4", lucky), r5 = scoreRound(arrs, "v5", lucky);
    const e4 = reference(r4.values, "v4"), e5 = reference(r5.values, "v5", arrs, lucky);
    const n4 = r4.pairs.filter((p) => p.gunner !== null).length, n5 = r5.pairs.filter((p) => p.gunner !== null).length;
    if (JSON.stringify(r4.totals) !== JSON.stringify(e4.totals) || JSON.stringify(r5.totals) !== JSON.stringify(e5.totals) || n4 !== e4.guns || n5 !== e5.guns) mismatch++;
    if (r4.totals.reduce((x, y) => x + y, 0) !== 0 || r5.totals.reduce((x, y) => x + y, 0) !== 0) nonZero++;
    if (n5 < n4) fewer++;
    g4 += n4; g5 += n5; if (r5.homeRun !== null) homeRuns5++;
  }
  eq([mismatch, nonZero, fewer, g5 > g4], [0, 0, 0, true], `G5 隨機 3000 局：v4、v5 都和獨立參考值一樣、四家總和都是 0、v5 打槍數不會比 v4 少（v4 打槍 ${g4} 次、v5 ${g5} 次、v5 全壘打 ${homeRuns5} 局）`);
}
// G6
{
  const s = (scoreRule?: string) => ({ settings: { arrangeSec: 30, totalHands: 8, baseScore: 100, ...(scoreRule ? { scoreRule } : {}) }, rest: cards("C5") }) as unknown as ThirteenGameState;
  eq([scoreRuleOf(s("v5").settings), scoreRuleOf(s("v4").settings), scoreRuleOf(s("jia").settings), scoreRuleOf(s().settings), luckyCardOf(s("v5"))?.rank, luckyCardOf(s("jia")),
    JSON.stringify(handRuleOf("v5", 5)) === JSON.stringify(handRuleOf("v4", 5)), rowPoints(3, "v5"), rowPoints(0, "v5"), homeRunPenaltyOf("v5")],
    ["v5", "v4", "jia", "v1", 5, null, true, 3, 0, 2], "G6 認得 v5；v5 的房有彩金牌，牌型、一般牌型 0、全壘打分照 v4（彩金牌型的加分和彩金分見 _thirteen-lucky-v5）");
}
// G7
{
  const room = (scoreRule: string) => ({ phase: "arranging", handNo: 1, hands: [], playerScores: [0, 0, 0, 0], nextReady: [], rest: cards("C5"),
    settings: { arrangeSec: 30, totalHands: 8, baseScore: 100, scoreRule },
    players: [ex1, P1, P1, P1].map((arrangement, seat) => ({ id: `p${seat}`, seat, name: `玩家${seat}`, userId: null, hand: [], arrangement, autoArranged: false })) }) as unknown as ThirteenGameState;
  const s5 = room("v5"), s4 = room("v4");
  revealIfReady(s5, 1000); revealIfReady(s4, 1000);
  const h5 = s5.hands[0], h4 = s4.hands[0];
  const dur = (s: ThirteenGameState) => (s.settleAt ?? 0) - (s.revealedAt ?? 0);
  eq([h5.result.pairs.filter((p) => p.gunner === 0).length, h5.result.homeRun, h5.scores, s5.playerScores, h5.stats?.map((x) => [x.guns, x.gunned, x.homeRunPoints]),
    matchStats(s5).map((m) => [m.guns, m.gunned, m.homeRuns, m.homeRunned, m.total])],
    [3, 0, [900, -300, -300, -300], [900, -300, -300, -300], [[3, 0, 6], [0, 1, -2], [0, 1, -2], [0, 1, -2]], [[3, 0, 1, 0, 900], [0, 1, 0, 1, -300], [0, 1, 0, 1, -300], [0, 1, 0, 1, -300]]],
    "G7 v5 房真的亮牌：打槍 3 家＋全壘打；底分 100 → +900／−300×3；左欄明細和整場累計的打槍、全壘打次數都照新規則");
  eq([dur(s5) - dur(s4), h4.result.homeRun, h4.scores, matchStats(s4)[0].guns], [3 * REVEAL_TIMING.GUN_MS + REVEAL_TIMING.HOME_RUN_MS, null, [0, 0, 0, 0], 0],
    "G7 亮牌動畫長度：v5 比 v4 多 3 槍＋全壘打的時間（前端照伺服器的 pairs.gunner 播）；同一副牌的 v4 房照舊規則，沒打槍、四家 0");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

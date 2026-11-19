// 十三支比牌與計分（規則書第 4 節；打槍罰分照老闆 2026-11-13 修改：被一家打槍多付那家 1 分）。
// 四家兩兩互比三道，每一道誰贏、贏家那道的特殊牌型數字（bonus）→ 那一道的分數照房間的計分規則（見 ScoreRule、rowPoints）：
//   v4（2026-11-19 定案）：一道的輸贏本身不算分，只有贏家那道是特殊牌型時，向這一道被他贏過的人收 bonus
//   v1、jia：一般牌型贏 +1、輸 −1；特殊牌型照舊表
// 三道全贏＝打槍，再付 GUN_PENALTY；
// 一家打槍另外三家＝全壘打，三家各再付全壘打分（v4 2、舊規則 3；和打槍疊加）。四人總分一定是 0。
import { checkArrangement, type Arrangement } from "./arrange";
import { CAT, compareValue, V4_NO_LUCKY, type HandRule, type HandValue } from "./hand";

export type Row = "front" | "middle" | "back";
export const ROWS: Row[] = ["front", "middle", "back"];

/** 規則參數：改規則只改這裡 */
export const SCORING = {
  /** 被打槍的人除了三道各輸 1 分，另外多付打槍者的分數（老闆 2026-11-13 修改：1 分；v2 原為 3） */
  GUN_PENALTY: 1,
  /** 全壘打：另外三家各再付的分數，和打槍疊加（舊規則 v1、jia） */
  HOME_RUN_PENALTY: 3,
  /** v4 的全壘打：另外三家各再付 2（加上三槍各 1，全壘打的人一共 +9、三家各 −3） */
  HOME_RUN_PENALTY_V4: 2,
  /** 舊規則（v1、jia 房）的特殊牌型表：v1 輸的人付 1＋這個數字；jia 輸的人只付這個數字；表上沒有的牌型照一般 1 墩 */
  BONUS: {
    front: { [CAT.THREE_KIND]: 2 },                                                  // 衝三
    middle: { [CAT.FOUR_KIND]: 4, [CAT.STRAIGHT_FLUSH]: 6, [CAT.FIVE_KIND]: 8 },     // 中道鐵支、同花順、五龍
    back: { [CAT.FOUR_KIND]: 2, [CAT.STRAIGHT_FLUSH]: 3, [CAT.FIVE_KIND]: 4 },       // 尾道鐵支、同花順、五龍
  } as Record<Row, Partial<Record<number, number>>>,
  /** v4（老闆 2026-11-19 定案，新開的房）：這一道被你贏過的人各付你這個數字；表上沒有＝0（一道的輸贏本身不算分） */
  BONUS_V4: {
    front: { [CAT.THREE_KIND]: 1, [CAT.LUCKY_THREE]: 2 },                                                           // 衝三 1、彩金衝三 2
    middle: { [CAT.LUCKY_FULL_HOUSE]: 1, [CAT.SPADE_STRAIGHT_FLUSH]: 2, [CAT.FOUR_KIND]: 2, [CAT.STRAIGHT_FLUSH]: 3,
      [CAT.LUCKY_FOUR]: 6, [CAT.FIVE_KIND]: 10 },                                                                   // 彩金葫蘆 1、黑桃同花順 2、鐵支 2、非黑桃同花順 3、彩金鐵支 6、五龍 10
    back: { [CAT.LUCKY_FULL_HOUSE]: 0, [CAT.SPADE_STRAIGHT_FLUSH]: 1, [CAT.FOUR_KIND]: 1, [CAT.STRAIGHT_FLUSH]: 2,
      [CAT.LUCKY_FOUR]: 3, [CAT.FIVE_KIND]: 5 },                                                                    // 彩金葫蘆 0、黑桃同花順 1、鐵支 1、非黑桃同花順 2、彩金鐵支 3、五龍 5
  } as Record<Row, Partial<Record<number, number>>>,
};

/**
 * 計分規則版本（房間開房時記在 settings.scoreRule，整場不變；見 flow.ts scoreRuleOf，不靠有沒有底分判斷）：
 *   "v4"  2026-11-19 定案後新開的房：牌型判斷用 v4（黑桃同花順、彩金牌型），一道的輸贏不算分，只算 BONUS_V4、打槍、全壘打
 *   "jia" 甲案的房：牌型判斷照舊，一般牌型那一道 1 墩，特殊牌型那一道只算 BONUS 表上的墩數
 *   "v1"  更早的房（沒有 scoreRule 欄位）：牌型判斷照舊，一般 1 墩，特殊牌型那一道＝1＋BONUS
 * 沒指定＝v4（前端理牌、推薦排法用的是新房的規則）
 */
export type ScoreRule = "v1" | "jia" | "v4";
const isV4 = (rule: ScoreRule | HandRule) => rule === "v4" || typeof rule === "object";
/** 計分規則用哪一套牌型判斷；lucky＝這一局彩金牌的點數（只有 v4 用得到） */
export const handRuleOf = (rule: ScoreRule, lucky: number | null = null): HandRule => (rule === "v4" ? { lucky } : "legacy");
/** 贏家那一道的特殊牌型數字（0＝一般牌型）；rule 可以給計分規則或牌型判斷規則，v4 用 BONUS_V4、其他用舊表 */
export const bonusOf = (row: Row, v: HandValue, rule: ScoreRule | HandRule = "v4") => ((isV4(rule) ? SCORING.BONUS_V4 : SCORING.BONUS)[row][v.cat] ?? 0);
/** 贏下一道時，輸家這一道付贏家多少：bonus＝贏家那道特殊牌型的數字（0＝一般牌型） */
export const rowPoints = (bonus: number, rule: ScoreRule): number => (rule === "v4" ? bonus : rule === "jia" ? (bonus > 0 ? bonus : 1) : 1 + bonus);
/** 全壘打時另外三家各付多少 */
export const homeRunPenaltyOf = (rule: ScoreRule): number => (rule === "v4" ? SCORING.HOME_RUN_PENALTY_V4 : SCORING.HOME_RUN_PENALTY);

/** 一組（a 對 b）的結果；points＝a 從 b 拿到的分數（負數＝a 付給 b） */
export interface PairResult {
  a: number;
  b: number;
  rows: Record<Row, { winner: number | null; bonus: number }>; // 每道誰贏（null＝平手）、贏家那道特殊牌型的數字（0＝一般牌型；那一道的分數見 rowPoints）
  gunner: number | null; // 打槍的座位（三道全贏）；沒有＝null
  points: number;
}

export interface RoundResult {
  totals: number[];          // 四家這局的總分（含全壘打），合計一定是 0
  pairs: PairResult[];       // 6 組兩兩結算（0-1、0-2、0-3、1-2、1-3、2-3）
  homeRun: number | null;    // 全壘打的座位
  values: Record<Row, HandValue>[]; // 四家各道的牌型（給畫面顯示）
}

type Values = Record<Row, HandValue>;

function scorePair(a: number, b: number, va: Values, vb: Values, rule: ScoreRule): PairResult {
  const rows = {} as PairResult["rows"];
  let points = 0, aWins = 0, bWins = 0;
  for (const row of ROWS) {
    const c = compareValue(va[row], vb[row]);
    if (c === 0) { rows[row] = { winner: null, bonus: 0 }; continue; }
    const aWin = c > 0;
    const bonus = bonusOf(row, aWin ? va[row] : vb[row], rule);
    rows[row] = { winner: aWin ? a : b, bonus };
    points += (aWin ? 1 : -1) * rowPoints(bonus, rule);
    if (aWin) aWins++; else bWins++;
  }
  const gunner = aWins === 3 ? a : bWins === 3 ? b : null;
  if (gunner === a) points += SCORING.GUN_PENALTY;
  if (gunner === b) points -= SCORING.GUN_PENALTY;
  return { a, b, rows, gunner, points };
}

/** 四家排好的牌 → 這局結算。每家的排法都要先通過倒水檢查（倒水的排法丟錯，不該走到這裡） */
export function scoreRound(arrangements: Arrangement[], rule: ScoreRule = "v4", lucky: number | null = null): RoundResult {
  if (arrangements.length !== 4) throw new Error("十三支要 4 家");
  const values = arrangements.map((a, seat) => {
    const c = checkArrangement(a, handRuleOf(rule, lucky));
    if (!c.ok) throw new Error(`座位 ${seat} 的排法不合法：${c.message}`);
    return c.values;
  });
  const totals = [0, 0, 0, 0];
  const pairs: PairResult[] = [];
  const guns = [0, 0, 0, 0]; // 每家打槍了幾家
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const p = scorePair(a, b, values[a], values[b], rule);
    pairs.push(p);
    totals[a] += p.points;
    totals[b] -= p.points;
    if (p.gunner !== null) guns[p.gunner]++;
  }
  const homeRun = guns.findIndex((n) => n === 3);
  if (homeRun >= 0) {
    const pen = homeRunPenaltyOf(rule);
    for (let s = 0; s < 4; s++) if (s !== homeRun) { totals[s] -= pen; totals[homeRun] += pen; }
  }
  if (totals.reduce((x, y) => x + y, 0) !== 0) throw new Error("四家總分不是 0（不應該發生）");
  return { totals, pairs, homeRun: homeRun >= 0 ? homeRun : null, values };
}

/**
 * 亮牌順序（規則書 2.5）：頭道、中道、尾道各自從最小亮到最大；一樣大的放同一組一起亮。
 * 回傳例：{ front: [[2], [0, 3], [1]], ... } ＝頭道先亮座位 2，再一起亮 0 和 3，最後亮 1。
 */
export function revealOrder(arrangements: Arrangement[], rule: ScoreRule = "v4", lucky: number | null = null): Record<Row, number[][]> {
  const values = arrangements.map((a) => {
    const c = checkArrangement(a, handRuleOf(rule, lucky));
    if (!c.ok) throw new Error(c.message);
    return c.values;
  });
  const out = {} as Record<Row, number[][]>;
  for (const row of ROWS) {
    const seats = values.map((_, i) => i).sort((x, y) => compareValue(values[x][row], values[y][row]) || x - y);
    const groups: number[][] = [];
    for (const s of seats) {
      const last = groups[groups.length - 1];
      if (last && compareValue(values[last[0]][row], values[s][row]) === 0) last.push(s);
      else groups.push([s]);
    }
    out[row] = groups;
  }
  return out;
}

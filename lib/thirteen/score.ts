// 十三支比牌與計分（規則書第 4 節；打槍罰分照老闆 2026-11-13 修改：被一家打槍多付那家 1 分）。
// 四家兩兩互比三道：一般牌型贏 +1、輸 −1、平手 0；贏家那道是特殊牌型時，那一道只算表上的墩數、不再加基本的 1
// （老闆 2026-11-19 甲案：衝三就是 2 墩；改之前是 1＋2＝3）；三道全贏＝打槍，再付 GUN_PENALTY；
// 一家打槍另外三家＝全壘打，三家各再付 HOME_RUN_PENALTY（和打槍疊加）。四人總分一定是 0。
import { checkArrangement, type Arrangement } from "./arrange";
import { CAT, compareValue, type HandValue } from "./hand";

export type Row = "front" | "middle" | "back";
export const ROWS: Row[] = ["front", "middle", "back"];

/** 規則參數：改規則只改這裡 */
export const SCORING = {
  /** 被打槍的人除了三道各輸 1 分，另外多付打槍者的分數（老闆 2026-11-13 修改：1 分；v2 原為 3） */
  GUN_PENALTY: 1,
  /** 全壘打：另外三家各再付的分數，和打槍疊加 */
  HOME_RUN_PENALTY: 3,
  /** 特殊牌型：贏家那一道是這些牌型時，輸的人付這個墩數（取代基本的 1，不是另外加；甲案 2026-11-19）；表上沒有的牌型照一般 1 墩 */
  BONUS: {
    front: { [CAT.THREE_KIND]: 2 },                                                  // 衝三
    middle: { [CAT.FOUR_KIND]: 4, [CAT.STRAIGHT_FLUSH]: 6, [CAT.FIVE_KIND]: 8 },     // 中道鐵支、同花順、五龍
    back: { [CAT.FOUR_KIND]: 2, [CAT.STRAIGHT_FLUSH]: 3, [CAT.FIVE_KIND]: 4 },       // 尾道鐵支、同花順、五龍
  } as Record<Row, Partial<Record<number, number>>>,
};

export const bonusOf = (row: Row, v: HandValue) => SCORING.BONUS[row][v.cat] ?? 0;

/**
 * 計分規則版本（審伯 2026-11-19 必修）：
 *   "jia" 甲案（2026-11-19 起新開的房）：特殊牌型那一道只算表上的墩數；一般牌型 1
 *   "v1"  舊規則（上線前開的房，整場都照舊）：特殊牌型那一道＝1＋表上的數字
 * 房間用哪一版看牌局設定 settings.scoreRule（見 flow.ts scoreRuleOf），不靠有沒有底分判斷
 */
export type ScoreRule = "v1" | "jia";
/** 贏下一道時這一道的墩數：bonus＝贏家那道特殊牌型在表上的數字（0＝一般牌型） */
export const rowPoints = (bonus: number, rule: ScoreRule): number => (rule === "jia" ? (bonus > 0 ? bonus : 1) : 1 + bonus);

/** 一組（a 對 b）的結果；points＝a 從 b 拿到的分數（負數＝a 付給 b） */
export interface PairResult {
  a: number;
  b: number;
  rows: Record<Row, { winner: number | null; bonus: number }>; // 每道誰贏（null＝平手）、贏家特殊牌型的墩數（0＝一般牌型，這道算 1 墩）
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
    const bonus = bonusOf(row, aWin ? va[row] : vb[row]);
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
export function scoreRound(arrangements: Arrangement[], rule: ScoreRule = "jia"): RoundResult {
  if (arrangements.length !== 4) throw new Error("十三支要 4 家");
  const values = arrangements.map((a, seat) => {
    const c = checkArrangement(a);
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
    for (let s = 0; s < 4; s++) if (s !== homeRun) { totals[s] -= SCORING.HOME_RUN_PENALTY; totals[homeRun] += SCORING.HOME_RUN_PENALTY; }
  }
  if (totals.reduce((x, y) => x + y, 0) !== 0) throw new Error("四家總分不是 0（不應該發生）");
  return { totals, pairs, homeRun: homeRun >= 0 ? homeRun : null, values };
}

/**
 * 亮牌順序（規則書 2.5）：頭道、中道、尾道各自從最小亮到最大；一樣大的放同一組一起亮。
 * 回傳例：{ front: [[2], [0, 3], [1]], ... } ＝頭道先亮座位 2，再一起亮 0 和 3，最後亮 1。
 */
export function revealOrder(arrangements: Arrangement[]): Record<Row, number[][]> {
  const values = arrangements.map((a) => {
    const c = checkArrangement(a);
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

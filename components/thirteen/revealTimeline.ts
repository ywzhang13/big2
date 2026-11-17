// 十三支亮牌時間軸（小宜 v5 §1～4、v7 §3）：純函式，畫面照「現在是第幾毫秒」算出要顯示什麼。
//   開始比牌 1.2 秒 → 頭墩、中墩、尾墩：每墩照伺服器給的翻牌順序（最小的先、一樣大的一起）每組 0.5 秒，
//   翻到衝三／鐵支／同花順／五龍就插播 0.9 秒特效（亮牌暫停，播完才翻下一家）；每墩固定 4 格翻牌（一樣大的一起翻就空著等）＋0.6 秒秀得失分
//   → 打槍（每組 1.0 秒）→ 全壘打（2.8 秒全螢幕）→ 本局結算面板
// 長度和伺服器同一套（lib/thirteen/flow.ts REVEAL_TIMING、revealDurationMs）：結算面板出現的時間＝伺服器的 settleAt，四家同步
// 起點用伺服器的亮牌時間 revealedAt：四家看到的進度一樣，重新整理也接得上（不會從頭再播）
import { CAT, CAT_NAME, SCORING, bonusOf, type Arrangement, type HandValue, type RoundResult, type Row } from "@/lib/thirteen";
import { REVEAL_TIMING, type HandStat } from "@/lib/thirteen/flow";

export const ROWS: Row[] = ["front", "middle", "back"];
export const ROW_NAME: Record<Row, string> = { front: "頭墩", middle: "中墩", back: "尾墩" };

/** 伺服器亮牌後給的內容（lib/thirteen/flow.ts revealPayload） */
export interface ThReveal {
  handNo: number;
  order: Record<Row, number[][]>;
  arrangements: Arrangement[];
  autoArranged: number[];
  result: RoundResult;
  /** 這局每家的明細（伺服器算，本局結算左欄用） */
  stats: HandStat[];
  playerScores: number[];
  over: boolean;
  /** 亮牌、結算面板出現、自動開下一局的伺服器時間（毫秒）；最後一局 nextHandAt＝null */
  revealedAt: number | null;
  settleAt: number | null;
  nextHandAt: number | null;
}

export type PatternFx = "chongsan" | "tiezhi" | "tonghuashun" | "wulong";
/** 一墩固定 4 格翻牌（0.5 秒一格）＋0.6 秒得失分＝REVEAL_TIMING.ROW_MS 2.6 秒 */
const FLIP_MS = 500, ROW_FLIP_SLOTS = 4;
export const MS = { start: REVEAL_TIMING.START_MS, flip: FLIP_MS, fx: REVEAL_TIMING.SPECIAL_MS, rowScore: REVEAL_TIMING.ROW_MS - ROW_FLIP_SLOTS * FLIP_MS,
  gun: REVEAL_TIMING.GUN_MS, homerun: REVEAL_TIMING.HOME_RUN_MS } as const;

export type Step =
  | { kind: "start"; t0: number; dur: number }
  | { kind: "flip"; t0: number; dur: number; row: Row; seats: number[] }
  | { kind: "fx"; t0: number; dur: number; row: Row; seat: number; fx: PatternFx }
  | { kind: "rowScore"; t0: number; dur: number; row: Row }
  | { kind: "gun"; t0: number; dur: number; from: number; to: number; n: number }
  | { kind: "homerun"; t0: number; dur: number; seat: number };

/** 這一墩的牌型要不要播特效：頭墩三條＝衝三；中墩、尾墩的鐵支、同花順、五龍 */
export function patternFx(row: Row, v: HandValue): PatternFx | null {
  if (row === "front") return v.cat === CAT.THREE_KIND ? "chongsan" : null;
  return v.cat === CAT.FIVE_KIND ? "wulong" : v.cat === CAT.STRAIGHT_FLUSH ? "tonghuashun" : v.cat === CAT.FOUR_KIND ? "tiezhi" : null;
}

/** 牌型徽章的字：頭墩三條寫「衝三」，同花一對、同花兩對寫「同花」；bonus＝有加分的牌型（紅金色） */
export function badgeOf(row: Row, v: HandValue): { label: string; bonus: boolean } {
  const label = row === "front" && v.cat === CAT.THREE_KIND ? "衝三"
    : v.cat === CAT.FLUSH_PAIR || v.cat === CAT.FLUSH_TWO_PAIR ? "同花" : CAT_NAME[v.cat];
  return { label, bonus: bonusOf(row, v) > 0 };
}

/** 每一墩每家的得失分（兩兩比：贏 +1＋加分、輸 −1−加分；不含打槍、全壘打） */
export function rowDeltas(result: RoundResult): Record<Row, number[]> {
  const out = { front: [0, 0, 0, 0], middle: [0, 0, 0, 0], back: [0, 0, 0, 0] } as Record<Row, number[]>;
  for (const p of result.pairs) for (const row of ROWS) {
    const r = p.rows[row];
    if (r.winner === null) continue;
    const loser = r.winner === p.a ? p.b : p.a;
    out[row][r.winner] += 1 + r.bonus;
    out[row][loser] -= 1 + r.bonus;
  }
  return out;
}

/** 打槍：誰打誰（照兩兩結算的順序） */
export const gunsOf = (result: RoundResult) =>
  result.pairs.filter((p) => p.gunner !== null).map((p) => ({ from: p.gunner!, to: p.gunner === p.a ? p.b : p.a }));

export function buildTimeline(rv: Pick<ThReveal, "order" | "result">): { steps: Step[]; end: number } {
  const steps: Step[] = [{ kind: "start", t0: 0, dur: MS.start }];
  let t: number = MS.start;
  for (const row of ROWS) {
    const rowStart = t;
    let fxTotal = 0;
    for (const seats of rv.order[row]) {
      steps.push({ kind: "flip", t0: t, dur: MS.flip, row, seats });
      let ft = t + MS.flip; // 先翻開（0.5 秒），再插播這組的特效，播完才翻下一組
      for (const seat of seats) {
        const fx = patternFx(row, rv.result.values[seat][row]);
        if (fx) { steps.push({ kind: "fx", t0: ft, dur: MS.fx, row, seat, fx }); ft += MS.fx; fxTotal += MS.fx; }
      }
      t = ft;
    }
    t = rowStart + ROW_FLIP_SLOTS * MS.flip + fxTotal; // 一樣大的一起翻、組數少於 4：空著等，總長和伺服器一樣
    steps.push({ kind: "rowScore", t0: t, dur: MS.rowScore, row });
    t += MS.rowScore;
  }
  gunsOf(rv.result).forEach((g, n) => { steps.push({ kind: "gun", t0: t, dur: MS.gun, ...g, n }); t += MS.gun; });
  if (rv.result.homeRun !== null) { steps.push({ kind: "homerun", t0: t, dur: MS.homerun, seat: rv.result.homeRun }); t += MS.homerun; }
  return { steps, end: t };
}

export interface RevealFrame {
  /** 每家已經翻開的墩 */
  open: Record<Row, boolean>[];
  /** 正在翻的（金色光暈）：座位 → 墩 */
  glow: { seat: number; row: Row }[];
  /** 現在這一墩（徽章、得失分只顯示這一墩；下一墩開始就淡掉） */
  row: Row | null;
  /** 這一墩的得失分出來了沒 */
  showRowScore: boolean;
  /** 被打槍（名字旁的小彈孔＋−N）：每家被打了幾槍（打槍那一段播到 0.6 秒才算） */
  shot: number[];
  /** 正在播的特效（含開始比牌、牌型、打槍、全壘打） */
  active: Step[];
  done: boolean;
}

export function frameAt(tl: { steps: Step[]; end: number }, t: number): RevealFrame {
  const open = [0, 1, 2, 3].map(() => ({ front: false, middle: false, back: false }));
  const glow: RevealFrame["glow"] = [];
  const shot = [0, 0, 0, 0];
  let row: Row | null = null;
  let showRowScore = false;
  for (const s of tl.steps) {
    if (s.t0 > t) continue;
    if (s.kind === "flip") {
      if (row !== s.row) showRowScore = false;
      row = s.row;
      for (const seat of s.seats) open[seat][s.row] = true;
      if (t < s.t0 + s.dur) for (const seat of s.seats) glow.push({ seat, row: s.row });
    } else if (s.kind === "rowScore") showRowScore = true;
    else if (s.kind === "gun") { row = null; if (t >= s.t0 + 600) shot[s.to]++; }
    else if (s.kind === "homerun") row = null;
  }
  const active = tl.steps.filter((s) => s.kind !== "flip" && s.kind !== "rowScore" && s.t0 <= t && t < s.t0 + s.dur);
  return { open, glow, row, showRowScore, shot, active, done: t >= tl.end };
}

/** 全部翻開（結算面板「查看牌桌」、整場結束補看用） */
export const allOpen = (): RevealFrame => ({
  open: [0, 1, 2, 3].map(() => ({ front: true, middle: true, back: true })), glow: [], row: null, showRowScore: false, shot: [0, 0, 0, 0], active: [], done: true,
});

/** 本局結算左欄：自己的明細（伺服器的 stats；有就列、沒有就不列），加起來＝本局分數 */
export function breakdown(st: HandStat): { label: string; pts: number }[] {
  const items: { label: string; pts: number }[] = [{ label: "墩分", pts: st.rows }];
  for (const b of st.bonuses) items.push({ label: b.points < 0 ? `被${b.name}` : b.name, pts: b.points });
  if (st.guns || st.gunned) {
    const per = SCORING.GUN_PENALTY; // 打槍幾家、被幾家打槍是伺服器給的次數；gunPoints＝(guns−gunned)×GUN_PENALTY
    if (st.guns && st.gunned) { items.push({ label: `打槍 ×${st.guns}`, pts: st.guns * per }); items.push({ label: `被打槍 ×${st.gunned}`, pts: -st.gunned * per }); }
    else items.push({ label: st.guns ? `打槍 ×${st.guns}` : `被打槍 ×${st.gunned}`, pts: st.gunPoints });
  }
  if (st.homeRun || st.homeRunned) items.push({ label: st.homeRun ? "全壘打" : "被全壘打", pts: st.homeRunPoints });
  return items;
}

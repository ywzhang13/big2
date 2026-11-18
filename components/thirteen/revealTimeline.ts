// 十三支亮牌時間軸：純函式，畫面照「現在是第幾毫秒」算出要顯示什麼。新節奏（老闆 2026-11-18、小宜 v12 §5）：
//   開始比牌 1.7 秒（大字 0.9）→ 頭墩、中墩、尾墩：照伺服器給的翻牌順序（最小的先）一家一家出，每家 1.5 秒、換墩不停；
//   大牌（衝三／鐵支／同花順／五龍）那家多佔 0.3 秒，大字 1.5 秒和下一家重疊；牌型、加分寫在中央看板（BoardFrame）
//   → 打槍（每槍 1.5 秒）→ 全壘打（3.2 秒）→ 停 1.2 秒 → 本局結算面板
// 長度和伺服器同一套（lib/thirteen/flow.ts REVEAL_TIMING、revealDurationMs）：結算面板出現的時間＝伺服器的 settleAt，四家同步
// 起點用伺服器的亮牌時間 revealedAt：四家看到的進度一樣，重新整理也接得上（不會從頭再播）
import { CAT, CAT_NAME, SCORING, bonusOf, evalRow, type Card, type Arrangement, type HandValue, type RoundResult, type Row } from "@/lib/thirteen";
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
/** 新節奏（老闆 2026-11-18 定案、照參考影片；小宜 v12 §5、老柯伺服器公式：1.7＋3×6.0＋0.3×大牌＋1.5×槍＋3.2×全壘打＋1.2）。
 *  伺服器常數（start、play、wait、special、gun、homerun、settle）直接讀 REVEAL_TIMING，兩邊一起變；其他是前端畫面用的：
 *  startWord「開始比牌」大字；flip 牌翻面移到出牌區；pop 牌型在看板跳出；scoreDelay 第四家牌型跳完到加分出現；
 *  fxDelay 大牌那家出牌後多久播大字；fx 大字長度（和下一家出牌重疊）。special＝大牌那家多佔的時間（留給看板顯示紅金牌型名） */
export const MS = {
  start: REVEAL_TIMING.START_MS, play: REVEAL_TIMING.PLAY_MS, wait: REVEAL_TIMING.ROW_WAIT_MS, special: REVEAL_TIMING.SPECIAL_MS,
  gun: REVEAL_TIMING.GUN_MS, homerun: REVEAL_TIMING.HOME_RUN_MS, settle: REVEAL_TIMING.SETTLE_PAUSE_MS,
  startWord: 900, flip: 350, pop: 300, scoreDelay: 100, fxDelay: 500, fx: 1500,
  /** 一墩最後一個牌型（含大牌紅金名）和加分至少停多久，才換墩或因打槍淡出看板（審伯必修 1：大牌在一墩最後一家時，大字播完名字也要看得到） */
  boardHold: 400,
} as const;
/** 結算面板時間公式（和伺服器 lib/thirteen/flow.ts revealDurationMs 同一個公式，測試 S4 逐局比對） */
export const revealDurationV8 = (specials: number, guns: number, homeRun: boolean) =>
  MS.start + 3 * (4 * MS.play + MS.wait) + MS.special * specials + MS.gun * guns + (homeRun ? MS.homerun : 0) + MS.settle;

export type Step =
  | { kind: "start"; t0: number; dur: number }
  | { kind: "flip"; t0: number; dur: number; row: Row; seats: number[]; big: boolean }  // 一家一家出，seats 只有一位；big＝大牌（多佔 special）
  | { kind: "fx"; t0: number; dur: number; row: Row; seat: number; fx: PatternFx }
  | { kind: "gun"; t0: number; dur: number; from: number; to: number; n: number }
  | { kind: "homerun"; t0: number; dur: number; seat: number };

/** 這一墩的牌型要不要播特效：頭墩三條＝衝三；中墩、尾墩的鐵支、同花順、五龍 */
export function patternFx(row: Row, v: HandValue): PatternFx | null {
  if (row === "front") return v.cat === CAT.THREE_KIND ? "chongsan" : null;
  return v.cat === CAT.FIVE_KIND ? "wulong" : v.cat === CAT.STRAIGHT_FLUSH ? "tonghuashun" : v.cat === CAT.FOUR_KIND ? "tiezhi" : null;
}

/** 一墩翻開時的排列（老闆 2026-11-18：A Q A A Q 要顯示成 A A A Q Q）：照計分引擎的比較序 keys（例如葫蘆＝[三條點數, 對子點數]）
 *  在 keys 前面的點數排前面，不在 keys 裡的（踢腳、順子其他張）照點數大到小 */
export function rowDisplayOrder(cards: Card[]): Card[] {
  const keys = evalRow(cards).keys;
  const at = (c: Card) => { const i = keys.indexOf(c.rank); return i < 0 ? keys.length : i; };
  return cards.slice().sort((a, b) => at(a) - at(b) || b.rank - a.rank);
}

/** 牌型徽章的字：頭墩三條寫「衝三」，其他照計分引擎的名稱（同花一對、同花兩對比同花大，照實寫；老闆 2026-11-18）；bonus＝有加分的牌型（紅金色） */
export function badgeOf(row: Row, v: HandValue): { label: string; bonus: boolean } {
  const label = row === "front" && v.cat === CAT.THREE_KIND ? "衝三" : CAT_NAME[v.cat];
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
  const steps: Step[] = [{ kind: "start", t0: 0, dur: MS.startWord }];
  let t: number = MS.start;
  for (const row of ROWS) {
    for (const seat of rv.order[row].flat()) { // 最小的先出；一樣大的照順序一家一家出（各 1.5 秒，大牌多 0.3）
      const fx = patternFx(row, rv.result.values[seat][row]);
      const dur = MS.play + (fx ? MS.special : 0);
      steps.push({ kind: "flip", t0: t, dur, row, seats: [seat], big: !!fx });
      if (fx) steps.push({ kind: "fx", t0: t + MS.fxDelay, dur: MS.fx, row, seat, fx }); // 大字從出牌後 0.5 秒播 1.5 秒，和下一家出牌重疊
      t += dur;
    }
    t += MS.wait; // 換墩不停（0）
  }
  gunsOf(rv.result).forEach((g, n) => { steps.push({ kind: "gun", t0: t, dur: MS.gun, ...g, n }); t += MS.gun; });
  if (rv.result.homeRun !== null) { steps.push({ kind: "homerun", t0: t, dur: MS.homerun, seat: rv.result.homeRun }); t += MS.homerun; }
  return { steps, end: t + MS.settle };
}

type FlipStep = Extract<Step, { kind: "flip" }>;
/** 牌型在看板出現的時間：一般牌型牌落定就跳出；大牌等大字播完（出牌後 0.5＋1.5 秒）才顯示紅金牌型名、不跳（老闆定案「大字播完中央也要顯示」） */
export const patternAt = (f: FlipStep) => f.t0 + (f.big ? MS.fxDelay + MS.fx : MS.flip);
/** 每一墩加分出現、清空的時間（小宜 v12 §5）：第四家牌型跳完 0.1 秒後出現；留到下一墩第一家的牌落定才清空；尾墩留到結算（end）。
 *  有打槍／全壘打時，尾墩在打槍開始時淡出。換墩或淡出都至少等加分出現 boardHold 之後（最後一家是大牌時，名字和加分才看得到） */
export function scoreWindows(tl: { steps: Step[]; end: number }): { row: Row; from: number; to: number }[] {
  const flips = tl.steps.filter((s): s is FlipStep => s.kind === "flip");
  const fxAt = tl.steps.find((s) => s.kind === "gun" || s.kind === "homerun")?.t0 ?? null;
  return ROWS.map((row, r) => {
    const mine = flips.filter((f) => f.row === row), last = mine[mine.length - 1];
    const from = patternAt(last) + (last.big ? 0 : MS.pop) + MS.scoreDelay;
    const next = r < 2 ? flips.find((f) => f.row === ROWS[r + 1]) : undefined;
    const to = next ? Math.max(next.t0 + MS.flip, from + MS.boardHold) : fxAt !== null ? Math.max(fxAt, from + MS.boardHold) : tl.end;
    return { row, from, to };
  });
}

/** 中央看板（小宜 v12）：這一墩四家的牌型（出完才出現）和加分（四家出完才出現） */
export interface BoardFrame {
  show: boolean;
  row: Row;
  /** 每個座位：牌型還沒出現（null）；big＝大牌（紅金、不跳）；at＝出現的時間（畫面用來當 key，跳出動畫只播一次）。牌型名由畫面用 badgeOf 算 */
  pats: ({ big: boolean; at: number } | null)[];
  /** 加分出現了沒（出現的時間，當 key） */
  scoreAt: number | null;
}

export interface RevealFrame {
  /** 每家已經翻開的墩 */
  open: Record<Row, boolean>[];
  /** 正在出的（金色光暈）：座位 → 墩 */
  glow: { seat: number; row: Row }[];
  board: BoardFrame;
  /** 被打槍（名字旁的小彈孔＋−N）：每家被打了幾槍（打槍那一段播到 0.26 秒才算） */
  shot: number[];
  /** 正在播的特效（含開始比牌、牌型、打槍、全壘打） */
  active: Step[];
  done: boolean;
}

export function frameAt(tl: { steps: Step[]; end: number }, t: number): RevealFrame {
  const open = [0, 1, 2, 3].map(() => ({ front: false, middle: false, back: false }));
  const glow: RevealFrame["glow"] = [];
  const shot = [0, 0, 0, 0];
  const ws = scoreWindows(tl);
  // 看板換墩：上一墩的加分視窗結束（下一墩第一家落定，而且上一墩的名字和加分至少停過 boardHold）
  const row: Row = t >= ws[1].to ? "back" : t >= ws[0].to ? "middle" : "front";
  const guns = tl.steps.some((s) => s.kind === "gun" || s.kind === "homerun");
  const hide = t < MS.startWord || (guns && t >= ws[2].to); // 「開始比牌」大字播完看板才淡入；打槍、全壘打時淡出
  for (const s of tl.steps) {
    if (s.t0 > t) continue;
    if (s.kind === "flip") {
      for (const seat of s.seats) open[seat][s.row] = true;
      if (t < s.t0 + s.dur) for (const seat of s.seats) glow.push({ seat, row: s.row });
    } else if (s.kind === "gun" && t >= s.t0 + 260) shot[s.to]++; // 每槍 0.26 秒中彈，彈孔留到結算
  }
  const pats: BoardFrame["pats"] = [null, null, null, null];
  for (const s of tl.steps) if (s.kind === "flip" && s.row === row && t >= patternAt(s)) for (const seat of s.seats) pats[seat] = { big: s.big, at: Math.max(patternAt(s), row === "front" ? 0 : ws[ROWS.indexOf(row) - 1].to) };
  const w = ws[ROWS.indexOf(row)];
  const board: BoardFrame = { show: !hide, row, pats, scoreAt: t >= w.from && t < w.to ? w.from : null };
  const active = tl.steps.filter((s) => s.kind !== "flip" && s.t0 <= t && t < s.t0 + s.dur);
  return { open, glow, board, shot, active, done: t >= tl.end };
}

/** 全部翻開（結算面板「查看牌桌」、整場結束補看用） */
export const allOpen = (): RevealFrame => ({
  open: [0, 1, 2, 3].map(() => ({ front: true, middle: true, back: true })), glow: [],
  board: { show: false, row: "back", pats: [null, null, null, null], scoreAt: null }, shot: [0, 0, 0, 0], active: [], done: true,
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

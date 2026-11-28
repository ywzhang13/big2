// 十三支亮牌時間軸：純函式，畫面照「現在是第幾毫秒」算出要顯示什麼。新節奏（老闆 2026-11-18、小宜 v12 §5）：
//   開始比牌 1.7 秒（大字 0.9）→ 頭墩、中墩、尾墩：照伺服器給的翻牌順序（最小的先）一家一家出，每家 1.5 秒、換墩不停；
//   大牌（衝三／鐵支／同花順／五龍）那家多佔 0.3 秒，大字 1.5 秒和下一家重疊；牌型、加分寫在中央看板（BoardFrame）
//   → 打槍（每槍 1.5 秒）→ 場內全壘打（5.0 秒，被三家打槍的那一家；老闆 2026-11-28）→ 全壘打（3.2 秒）→ 停 1.2 秒 → 本局結算面板
// 長度和伺服器同一套（lib/thirteen/flow.ts REVEAL_TIMING、revealDurationMs）：結算面板出現的時間＝伺服器的 settleAt，四家同步
// 起點用伺服器的亮牌時間 revealedAt：四家看到的進度一樣，重新整理也接得上（不會從頭再播）
import { CAT, SCORING, bonusOf, rowPoints, type Card, type Arrangement, type HandValue, type RoundResult, type Row } from "@/lib/thirteen";
import { rowCatName, rowDisplayOrder } from "./arrangeState";
import { insideHomeRunOf, REVEAL_TIMING, type HandStat, type ScoredStat } from "@/lib/thirteen/flow";

export const ROWS: Row[] = ["front", "middle", "back"];
export const ROW_NAME: Record<Row, string> = { front: "頭墩", middle: "中墩", back: "尾墩" };

/** 伺服器亮牌後給的內容（lib/thirteen/flow.ts revealPayload） */
export interface ThReveal {
  handNo: number;
  order: Record<Row, number[][]>;
  arrangements: Arrangement[];
  autoArranged: number[];
  result: RoundResult;
  /** 這局每家的明細（伺服器算，墩數）：本局結算左欄照這個顯示（老闆 2026-11-19：左欄是墩數）；scored（乘好底分的版本）前端不用 */
  stats: (HandStat & { gunEach?: number; scored?: ScoredStat })[];
  /** 每一墩每家的得失分（有底分的房由伺服器乘好給，中央看板用；舊房沒有，前端用 rowDeltas(result) 算，和改之前一樣） */
  rowDeltas?: Record<Row, number[]>;
  /** 這局四家的分數（老柯 2026-11-19：＝淨墩數 result.totals × 底分，伺服器乘好）；result.totals、stats 維持墩數給出牌動畫和明細。舊房沒有，退回 result.totals */
  scores?: number[];
  /** 每家 16 張裡沒用到的 3 張（老柯 v4，比牌後才給，理牌時看不到別人的牌）；還沒有的版本不給，前端就不顯示 */
  unusedCards?: Card[][];
  /** 這房的底分（舊房伺服器補 1） */
  baseScore?: number;
  /** 計分規則（老柯 API 0-1c、v4）："v4"＝v4 上線後開的房；"jia"＝甲案；沒有＝更早的舊房，照舊規則 v1 */
  scoreRule?: "jia" | "v1" | "v4" | "v5";
  /** 這一局的彩金牌（v4 房；舊房 null 或沒有） */
  luckyCard?: Card | null;
  playerScores: number[];
  over: boolean;
  /** 亮牌、結算面板出現、自動開下一局的伺服器時間（毫秒）；最後一局 nextHandAt＝null */
  revealedAt: number | null;
  settleAt: number | null;
  nextHandAt: number | null;
}

export type PatternFx = "chongsan" | "tiezhi" | "tonghuashun" | "wulong" | "jpchongsan" | "jphulu" | "jptiezhi";
/** 新節奏（老闆 2026-11-18 定案、照參考影片；小宜 v12 §5、老柯伺服器公式：1.7＋3×6.0＋0.3×大牌＋1.5×槍＋3.2×全壘打＋1.2）。
 *  伺服器常數（start、play、wait、special、gun、homerun、settle）直接讀 REVEAL_TIMING，兩邊一起變；其他是前端畫面用的：
 *  startWord「開始比牌」大字；flip 牌翻面移到出牌區；pop 牌型在看板跳出；scoreDelay 第四家牌型跳完到加分出現；
 *  fxDelay 大牌那家出牌後多久播大字；fx 大字長度（和下一家出牌重疊）。special＝大牌那家多佔的時間（留給看板顯示紅金牌型名） */
export const MS = {
  start: REVEAL_TIMING.START_MS, play: REVEAL_TIMING.PLAY_MS, wait: REVEAL_TIMING.ROW_WAIT_MS, special: REVEAL_TIMING.SPECIAL_MS,
  gun: REVEAL_TIMING.GUN_MS, homerun: REVEAL_TIMING.HOME_RUN_MS, insidehr: REVEAL_TIMING.INSIDE_HR_MS, settle: REVEAL_TIMING.SETTLE_PAUSE_MS,
  startWord: 900, flip: 350, pop: 300, scoreDelay: 100, fxDelay: 500, fx: 1500,
  /** 一墩最後一個牌型（含大牌紅金名）和加分至少停多久，才換墩或因打槍淡出看板（審伯必修 1：大牌在一墩最後一家時，大字播完名字也要看得到） */
  boardHold: 400,
} as const;
/** 結算面板時間公式（和伺服器 lib/thirteen/flow.ts revealDurationMs 同一個公式，測試 S4 逐局比對） */
export const revealDurationV8 = (specials: number, guns: number, homeRun: boolean, insideHr = false) =>
  MS.start + 3 * (4 * MS.play + MS.wait) + MS.special * specials + MS.gun * guns + (homeRun ? MS.homerun : 0) + (insideHr ? MS.insidehr : 0) + MS.settle;

export type Step =
  | { kind: "start"; t0: number; dur: number }
  | { kind: "flip"; t0: number; dur: number; row: Row; seats: number[]; big: boolean; fx: boolean }  // 一家一家出，seats 只有一位；big＝大牌（多佔 special、紅金牌型名）；fx＝有大字特效
  | { kind: "fx"; t0: number; dur: number; row: Row; seat: number; fx: PatternFx }
  | { kind: "gun"; t0: number; dur: number; from: number; to: number; n: number }
  | { kind: "homerun"; t0: number; dur: number; seat: number }
  /** 場內全壘打（老闆 2026-11-28）：seat＝被另外三家都打槍的那一家 */
  | { kind: "insidehr"; t0: number; dur: number; seat: number };

/** 這一墩的牌型播哪個大字（老闆 2026-11-20 新圖：彩金三種各有自己的字，不再借用一般版）：頭墩衝三／彩金衝三；中墩、尾墩的鐵支／彩金鐵支、
 *  同花順（黑桃和非黑桃共用，老闆 2026-11-19）、五龍；中墩彩金葫蘆（尾墩彩金葫蘆不加分、不是大牌，所以沒有大字）。
 *  只有「大牌」（isBigPattern）才會真的播，時間軸照這個挑 */
export function patternFx(row: Row, v: HandValue): PatternFx | null {
  if (row === "front") return v.cat === CAT.THREE_KIND ? "chongsan" : v.cat === CAT.LUCKY_THREE ? "jpchongsan" : null;
  if (v.cat === CAT.FIVE_KIND) return "wulong";
  if (v.cat === CAT.STRAIGHT_FLUSH || v.cat === CAT.SPADE_STRAIGHT_FLUSH) return "tonghuashun";
  if (v.cat === CAT.LUCKY_FOUR) return "jptiezhi";
  if (v.cat === CAT.LUCKY_FULL_HOUSE) return "jphulu";
  return v.cat === CAT.FOUR_KIND ? "tiezhi" : null;
}
/** 大牌（多佔 0.3 秒、紅金牌型名）：和伺服器 revealDurationMs 同一個條件 bonusOf(row, v) > 0，兩邊的亮牌長度才會一樣
 *  （v4 表；舊房的特殊牌型在 v4 表上也都 > 0，所以舊房一樣） */
export const isBigPattern = (row: Row, v: HandValue) => bonusOf(row, v) > 0;

/** 一墩翻開時的排列（老闆 2026-11-19：A、2、3…J、Q、K；10 J Q K A 的順子、同花順 A 放最後）。跟理牌畫面同一支 */
export { rowDisplayOrder };

/** 牌型徽章的字：頭墩三條寫「衝三」、彩金三條寫「彩金衝三」，其他照計分引擎的名稱（同花一對、同花兩對照實寫；v4 的彩金三條／葫蘆／鐵支、黑桃同花順、同花順）；
 *  bonus＝大牌（紅金色），和亮牌時間軸同一個判斷 */
export function badgeOf(row: Row, v: HandValue): { label: string; bonus: boolean } {
  return { label: rowCatName(row, v.cat), bonus: isBigPattern(row, v) };
}

/** 每一墩每家的得失分（兩兩比；不含打槍、全壘打）。只在伺服器沒給 rv.rowDeltas 時用。
 *  甲案（scoreRule "jia"）：特殊牌型那一墩算表上的墩數、一般牌型 1；舊規則（沒有 scoreRule）：1＋表上的數字（老柯 API 0-1c，審伯必修：舊局要和已存的總分對得上） */
export function rowDeltas(result: RoundResult, scoreRule?: ThReveal["scoreRule"]): Record<Row, number[]> {
  const out = { front: [0, 0, 0, 0], middle: [0, 0, 0, 0], back: [0, 0, 0, 0] } as Record<Row, number[]>;
  for (const p of result.pairs) for (const row of ROWS) {
    const r = p.rows[row];
    if (r.winner === null) continue;
    const loser = r.winner === p.a ? p.b : p.a;
    const unit = rowPoints(r.bonus, scoreRule ?? "v1"); // 和後端 score.ts 同一條規則（v4：一般牌型那一道 0）
    if (unit === 0) continue;
    out[row][r.winner] += unit;
    out[row][loser] -= unit;
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
      const v = rv.result.values[seat][row];
      const big = isBigPattern(row, v), fx = big ? patternFx(row, v) : null;
      const dur = MS.play + (big ? MS.special : 0);
      steps.push({ kind: "flip", t0: t, dur, row, seats: [seat], big, fx: !!fx });
      if (fx) steps.push({ kind: "fx", t0: t + MS.fxDelay, dur: MS.fx, row, seat, fx }); // 大字從出牌後 0.5 秒播 1.5 秒，和下一家出牌重疊
      t += dur;
    }
    t += MS.wait; // 換墩不停（0）
  }
  gunsOf(rv.result).forEach((g, n) => { steps.push({ kind: "gun", t0: t, dur: MS.gun, ...g, n }); t += MS.gun; });
  const ihr = insideHomeRunOf(rv.result); // 同一局也有全壘打：先播場內全壘打、再播全壘打（老闆 2026-11-28）；總長和伺服器 revealDurationMs 一樣（兩段相加，順序不影響）
  if (ihr !== null) { steps.push({ kind: "insidehr", t0: t, dur: MS.insidehr, seat: ihr }); t += MS.insidehr; }
  if (rv.result.homeRun !== null) { steps.push({ kind: "homerun", t0: t, dur: MS.homerun, seat: rv.result.homeRun }); t += MS.homerun; }
  return { steps, end: t + MS.settle };
}

type FlipStep = Extract<Step, { kind: "flip" }>;
/** 牌型在看板出現的時間：一般牌型牌落定就跳出；有大字的大牌等大字播完（出牌後 0.5＋1.5 秒）才顯示紅金牌型名、不跳（老闆定案「大字播完中央也要顯示」）；
 *  沒有大字的大牌（彩金葫蘆）牌落定就顯示紅金名 */
export const patternAt = (f: FlipStep) => f.t0 + (f.fx ? MS.fxDelay + MS.fx : MS.flip);
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
  const guns = tl.steps.some((s) => s.kind === "gun" || s.kind === "homerun" || s.kind === "insidehr");
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
  // 老闆 2026-11-19 定案：本局結算左欄一律是墩數（stats 本身，不乘底分）；右欄四家和名牌才是乘過底分的輸贏（scores、playerScores）
  // 老闆 2026-11-20：彩金分放最上面（各墩牌型加分之前）；左欄的「彩金衝三」一律寫「衝三」（比較不會有爭議，牌上的徽章、大字特效、配音照舊叫彩金衝三）
  const items: { label: string; pts: number }[] = [];
  // v5 彩金分（老柯 stats.luckyPoints，墩數單位）：拿到的人 +3、其他三家各 −1；舊局／沒有彩金分＝沒有這個欄位或 0，不列。左欄一律是墩數，跟其他行一樣不乘底分
  if (st.luckyPoints) items.push({ label: "彩金分", pts: st.luckyPoints });
  items.push({ label: "墩分", pts: st.rows });
  for (const b of st.bonuses) { const name = b.name.replace("彩金衝三", "衝三"); items.push({ label: b.points < 0 ? `被${name}` : name, pts: b.points }); }
  if (st.guns || st.gunned) {
    const per = SCORING.GUN_PENALTY; // 打槍幾家、被幾家打槍是伺服器給的次數；gunPoints＝(guns−gunned)×每槍墩數
    if (st.guns && st.gunned) { items.push({ label: `打槍 ×${st.guns}`, pts: st.guns * per }); items.push({ label: `被打槍 ×${st.gunned}`, pts: -st.gunned * per }); }
    else items.push({ label: st.guns ? `打槍 ×${st.guns}` : `被打槍 ×${st.gunned}`, pts: st.gunPoints });
  }
  if (st.homeRun || st.homeRunned) items.push({ label: st.homeRun ? "全壘打" : "被全壘打", pts: st.homeRunPoints });
  return items;
}

/** 中央看板的每墩得失分：伺服器給了（有底分、已經乘好）就用伺服器的，沒給（舊房）照舊自己算 */
export const boardDeltas = (rv: Pick<ThReveal, "result" | "rowDeltas" | "scoreRule">): Record<Row, number[]> => rv.rowDeltas ?? rowDeltas(rv.result, rv.scoreRule);

/** 本局結算「這局幾分」：伺服器給的 scores（已乘底分）；舊房沒有就照舊用 result.totals */
export const handScore = (rv: Pick<ThReveal, "result" | "scores">, seat: number): number => rv.scores?.[seat] ?? rv.result.totals[seat];
/** 亮牌途中名牌的分數（老闆 2026-11-19：一開始比牌就跳成這局的結果，等於提前知道輸贏）：
 *  伺服器亮牌時 playerScores 已經含這一局，所以本局結算出現前顯示「減掉這一局」＝上一局結束時的累計；結算出現後才是新的累計 */
export const plateScore = (rv: Pick<ThReveal, "result" | "scores" | "playerScores">, seat: number, settled: boolean): number =>
  (rv.playerScores[seat] ?? 0) - (settled ? 0 : handScore(rv, seat));

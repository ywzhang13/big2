// 麻將牌局回放（老闆 2026-11-13：保留 7 天、只有上桌 4 人能看、可切換四家視角）。
// 純函式、不連資料庫，伺服器存檔和前端重播都能用。
//
// 怎麼記：不改任何打牌流程，只在每次存牌局狀態（lib/mahjong/db.ts 的兩個存檔函式）時呼叫 stepReplay：
//   - 一局開始的第一次存檔：記下發完牌的樣子（四家手牌、花、剩下的牌牆順序）＝ init
//   - 之後每次存檔：和上一步比對四家的手牌、吃碰槓、花、海底，只記「哪幾張牌移到哪裡」＝ 一個事件
//   - 這局結算的那次存檔：補上最後一步和結果，回傳整局紀錄（由呼叫端寫進 mj_hand_replays），牌局狀態裡只留一個小標記
// 進行中的紀錄放在牌局狀態的 replayLog（只在伺服器；toPublicGameState／toPlayerGameState／toSpectatorGameState 都是逐欄挑選，不會帶出去），
// 跟著原本每一步就會做的存檔一起寫，打牌當下不多任何請求。
//
// 牌的 id 0～143 固定對應牌面（tiles.ts buildTiles），所以紀錄只存 id；tileFace(id) 換回牌面。
import type { MahjongGameState } from "../gameState";
import { buildTiles, type Tile } from "../tiles";

export const REPLAY_VERSION = 1;

/** 一副吃碰槓：[種類, 誰打出來的（-1＝自己摸的／暗槓）, ...牌 id] */
export type MeldSnap = [type: string, from: number, ...ids: number[]];
/** 一個座位在某一步的樣子 */
export interface SeatSnap {
  h: number[];      // 手牌（id 由小到大）
  m: MeldSnap[];    // 吃碰槓
  f: number[];      // 花（補到的順序）
  d: number[];      // 打出去的牌（打出的順序；被吃碰胡走的牌仍留在這裡，和牌局狀態一致）
}
/** 一個座位這一步的變化：只列有變的欄位 */
export interface SeatDelta {
  s: number;        // 座位 0～3
  ha?: number[];    // 手牌多了哪些
  hr?: number[];    // 手牌少了哪些
  m?: MeldSnap[];   // 吃碰槓整組換成這份（有變才給）
  fa?: number[];    // 花接在後面多了哪些
  da?: number[];    // 海底接在後面多了哪些
  f?: number[];     // 花整份換成這份（不是單純接在後面時才用，正常不會出現）
  d?: number[];     // 海底整份換成這份（同上）
}
/**
 * 一步（＝一次存檔）。tags：這一步發生了什麼，可能同時好幾個（例如眼牌自動摸打＝draw＋discard）：
 *   draw 摸牌（含補牌）、flower 補花、discard 打牌、chi 吃、pong 碰、kong 明槓、concealed_kong 暗槓、add_kong 加槓、
 *   eye 宣告眼牌、ting 地聽、win 胡（放槍、搶槓）、zimo 自摸、draw_game 流局
 */
export interface ReplayEvent {
  t: number;        // 距離這局開始幾毫秒
  k: string[];      // tags
  c: number;        // 這一步之後輪到誰（currentTurn）
  w: number;        // 牌牆剩幾張
  p: SeatDelta[];   // 有變化的座位
  e?: number[];     // 這一步新宣告眼牌的座位
  ti?: number[];    // 這一步新宣告地聽的座位
}

export interface ReplayWinner {
  seat: number;
  from: number | null;   // 放槍的座位；自摸、八仙過海＝null
  selfDraw: boolean;
  winTile: number | null;
  fans: { name: string; value: number }[];
  totalFan: number;
}
export interface ReplayResult {
  reason: "win" | "self_draw" | "draw";
  winners: ReplayWinner[];
  deltas: number[];      // 這局每家輸贏
  scores: number[] | null; // 這局結束後的累計
}

/** 一局的完整回放（存進 mj_hand_replays.data） */
export interface ReplayRecord {
  v: number;
  hand: number;          // 這場第幾局（＝handsCompleted）
  round: number | null;  // 第幾圈
  game: number | null;   // 圈內第幾局
  dealerConsecutive: number;
  wind: number;          // 圈風 1～4
  dealer: number;        // 莊家座位
  door: number | null;   // 開門座位
  dice: number[] | null;
  seats: { seat: number; name: string }[];
  init: { seats: SeatSnap[]; wall: number[] }; // 發完牌（含起手補花）的樣子；wall＝剩下的牌牆，照摸牌順序
  events: CompactEvent[];   // 存檔用的精簡格式；decodeRecord 換成 ReplayEvent
  result: ReplayResult;
  durationMs: number;
}

/** API 回給前端的樣子：events 已解開成 ReplayEvent */
export type ReplayView = Omit<ReplayRecord, "events"> & { events: ReplayEvent[] };

/** 列表用的摘要（存進 mj_hand_replays.summary，列表不用讀整份紀錄） */
export interface ReplaySummary {
  hand: number;
  round: number | null;
  game: number | null;
  wind: number;
  dealer: number;
  reason: ReplayResult["reason"];
  winners: { seat: number; from: number | null; selfDraw: boolean; totalFan: number }[];
  deltas: number[];
  steps: number;
  durationMs: number;
}

/** 進行中的紀錄（牌局狀態 replayLog）；done＝這局已經交出去了，只留標記避免重複 */
export type ReplayLog =
  | { v: number; n: number; done?: false; at: number; init: ReplayRecord["init"]; head: Omit<ReplayRecord, "v" | "hand" | "init" | "events" | "result" | "durationMs">; ev: CompactEvent[]; eye: number[]; ting: number[] }
  | { v: number; n: number; done: true };


// ---------------------------------------------------------------------------
// 精簡格式（存在牌局狀態和資料庫裡；一步約 25～35 bytes）
//   [時間（0.1 秒）, 輪到誰, 牌牆剩幾張, "tag+tag", ...片段]
//   片段：座位變化 "<座位><段>..."，段＝"+id.id" 手牌多、"-id.id" 手牌少、"f+id" 花多、"d+id" 海底多、
//         "F=id.id" 花整份、"D=id.id" 海底整份、"M=<種類><來源+1>:id.id,..." 吃碰槓整份（種類 c 吃 p 碰 k 明槓 a 暗槓；來源 0＝自己）
//         "E<座位...>" 新宣告眼牌、"T<座位...>" 新宣告地聽
// ---------------------------------------------------------------------------
export type CompactEvent = (number | string)[];
const MELD_CODE: Record<string, string> = { chi: "c", pong: "p", kong: "k", concealed_kong: "a" };
const MELD_NAME: Record<string, string> = { c: "chi", p: "pong", k: "kong", a: "concealed_kong" };
const join = (xs: number[]) => xs.join(".");
const split = (x: string) => (x ? x.split(".").map(Number) : []);

export function encodeEvent(ev: ReplayEvent): CompactEvent {
  const segs: string[] = ev.p.map((d) => {
    let out = String(d.s);
    if (d.hr) out += "-" + join(d.hr);
    if (d.ha) out += "+" + join(d.ha);
    if (d.m) out += "M=" + d.m.map((m) => `${MELD_CODE[m[0]] ?? m[0]}${(m[1] as number) + 1}:${join(m.slice(2) as number[])}`).join(",");
    if (d.f) out += "F=" + join(d.f); else if (d.fa) out += "f+" + join(d.fa);
    if (d.d) out += "D=" + join(d.d); else if (d.da) out += "d+" + join(d.da);
    return out;
  });
  if (ev.e?.length) segs.push("E" + ev.e.join(""));
  if (ev.ti?.length) segs.push("T" + ev.ti.join(""));
  return [Math.round(ev.t / 100), ev.c, ev.w, ev.k.join("+"), ...segs];
}

export function decodeEvent(c: CompactEvent): ReplayEvent {
  const [t, cur, w, k, ...segs] = c;
  const ev: ReplayEvent = { t: Number(t) * 100, k: k ? String(k).split("+") : [], c: Number(cur), w: Number(w), p: [] };
  for (const raw of segs as string[]) {
    if (raw[0] === "E") { ev.e = raw.slice(1).split("").map(Number); continue; }
    if (raw[0] === "T") { ev.ti = raw.slice(1).split("").map(Number); continue; }
    const d: SeatDelta = { s: Number(raw[0]) };
    for (const [, op, val] of raw.slice(1).matchAll(/(f\+|d\+|F=|D=|M=|\+|-)([^+\-=fdFDM]*)/g)) {
      if (op === "+") d.ha = split(val);
      else if (op === "-") d.hr = split(val);
      else if (op === "f+") d.fa = split(val);
      else if (op === "d+") d.da = split(val);
      else if (op === "F=") d.f = split(val);
      else if (op === "D=") d.d = split(val);
      else d.m = val ? val.split(",").map((m) => {
        const [head, list] = m.split(":");
        return [MELD_NAME[head[0]] ?? head[0], Number(head.slice(1)) - 1, ...split(list)] as MeldSnap;
      }) : [];
    }
    ev.p.push(d);
  }
  return ev;
}

/** 存檔格式 → 前端用的樣子 */
export function decodeRecord(rec: ReplayRecord): ReplayView {
  return { ...rec, events: rec.events.map(decodeEvent) };
}

// ---------------------------------------------------------------------------
// 快照與比對
// ---------------------------------------------------------------------------

const ids = (ts: Tile[]) => ts.map((t) => t.id);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const meldSnap = (m: MahjongGameState["players"][number]["revealed"][number]): MeldSnap => [m.type, m.from ?? -1, ...ids(m.tiles)];

/** 牌局狀態 → 四家這一步的樣子 */
export function snapshot(s: MahjongGameState): SeatSnap[] {
  return [0, 1, 2, 3].map((seat) => {
    const p = s.players.find((x) => x.seat === seat);
    return p
      ? { h: sorted(ids(p.hand)), m: p.revealed.map(meldSnap), f: ids(p.flowers), d: ids(p.discards) }
      : { h: [], m: [], f: [], d: [] };
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const startsWith = (xs: number[], prefix: number[]) => prefix.length <= xs.length && prefix.every((x, i) => xs[i] === x);

function diffSeat(seat: number, a: SeatSnap, b: SeatSnap): SeatDelta | null {
  const d: SeatDelta = { s: seat };
  const before = new Set(a.h), after = new Set(b.h);
  const ha = b.h.filter((x) => !before.has(x)), hr = a.h.filter((x) => !after.has(x));
  if (ha.length) d.ha = ha;
  if (hr.length) d.hr = hr;
  if (!same(a.m, b.m)) d.m = b.m;
  if (!same(a.f, b.f)) { if (startsWith(b.f, a.f)) d.fa = b.f.slice(a.f.length); else d.f = b.f; }
  if (!same(a.d, b.d)) { if (startsWith(b.d, a.d)) d.da = b.d.slice(a.d.length); else d.d = b.d; }
  return Object.keys(d).length > 1 ? d : null;
}

/** 把一步的變化套到快照上（重播用；不改傳入的快照） */
export function applyEvent(seats: SeatSnap[], ev: Pick<ReplayEvent, "p">): SeatSnap[] {
  const out = seats.map((x) => ({ h: [...x.h], m: x.m.map((m) => [...m] as MeldSnap), f: [...x.f], d: [...x.d] }));
  for (const d of ev.p) {
    const x = out[d.s];
    if (d.hr) { const rm = new Set(d.hr); x.h = x.h.filter((id) => !rm.has(id)); }
    if (d.ha) x.h = sorted([...x.h, ...d.ha]);
    if (d.m) x.m = d.m.map((m) => [...m] as MeldSnap);
    if (d.f) x.f = [...d.f]; else if (d.fa) x.f.push(...d.fa);
    if (d.d) x.d = [...d.d]; else if (d.da) x.d.push(...d.da);
  }
  return out;
}

/** 整局每一步的四家樣子：[0]＝發完牌，[i]＝第 i 個事件之後 */
export function replayFrames(rec: Pick<ReplayView, "init" | "events">): SeatSnap[][] {
  const frames = [rec.init.seats];
  for (const ev of rec.events) frames.push(applyEvent(frames[frames.length - 1], ev));
  return frames;
}

function tagsOf(a: SeatSnap[], b: SeatSnap[], wallBefore: number, wallAfter: number): string[] {
  const k: string[] = [];
  if (wallAfter < wallBefore) k.push("draw");
  if (b.some((x, i) => x.f.length > a[i].f.length)) k.push("flower");
  for (let i = 0; i < 4; i++) {
    const ma = a[i].m, mb = b[i].m;
    if (mb.length > ma.length) for (const m of mb.slice(ma.length)) k.push(String(m[0]));
    else if (mb.some((m, j) => ma[j] && m[0] === "kong" && ma[j][0] === "pong")) k.push("add_kong");
  }
  if (b.some((x, i) => x.d.length > a[i].d.length)) k.push("discard");
  return k;
}

/** 目前這一步的四家樣子（從 init 套完所有事件） */
function current(log: Extract<ReplayLog, { done?: false }>): SeatSnap[] {
  return replayFrames({ init: log.init, events: log.ev.map(decodeEvent) }).pop()!;
}

function lastWall(log: Extract<ReplayLog, { done?: false }>): number {
  return log.ev.length ? Number(log.ev[log.ev.length - 1][2]) : log.init.wall.length;
}

/** 和上一步比對，有變化才記一個事件 */
function append(log: Extract<ReplayLog, { done?: false }>, s: MahjongGameState, now: number, extra: string[] = []): void {
  const a = current(log);
  const b = snapshot(s);
  const p = [0, 1, 2, 3].map((i) => diffSeat(i, a[i], b[i])).filter((x): x is SeatDelta => x !== null);
  const eye = (s.eyeSeats ?? []).filter((x) => !log.eye.includes(x));
  const ting = (s.tingSeats ?? []).filter((x) => !log.ting.includes(x));
  const k = [...tagsOf(a, b, lastWall(log), s.wall.length), ...(eye.length ? ["eye"] : []), ...(ting.length ? ["ting"] : []), ...extra];
  if (p.length === 0 && k.length === 0) return; // pass、等待中的動作：牌沒有動，不記
  const ev: ReplayEvent = { t: Math.max(0, now - log.at), k, c: s.currentTurn, w: s.wall.length, p };
  if (eye.length) { ev.e = eye; log.eye.push(...eye); }
  if (ting.length) { ev.ti = ting; log.ting.push(...ting); }
  log.ev.push(encodeEvent(ev));
}

/** 一局剛發完牌（還沒有人打牌、吃碰槓）才開始記；上線當下正在打到一半的局不記（記不完整） */
function isFreshDeal(s: MahjongGameState): boolean {
  return s.players.length === 4 && s.players.every((p) => p.discards.length === 0 && p.revealed.length === 0);
}

function startLog(s: MahjongGameState, n: number, now: number): Extract<ReplayLog, { done?: false }> {
  return {
    v: REPLAY_VERSION, n, at: now,
    init: { seats: snapshot(s), wall: ids(s.wall) },
    head: {
      round: s.roundInfo?.currentRound ?? null,
      game: s.roundInfo?.currentGame ?? null,
      dealerConsecutive: s.roundInfo?.dealerConsecutive ?? 0,
      wind: s.prevalentWind,
      dealer: s.dealerSeat,
      door: s.doorSeat ?? null,
      dice: s.dice ? [...s.dice] : null,
      seats: [0, 1, 2, 3].map((seat) => ({ seat, name: s.players.find((p) => p.seat === seat)?.name ?? "" })),
    },
    ev: [], eye: [...(s.eyeSeats ?? [])], ting: [...(s.tingSeats ?? [])],
  };
}

function resultOf(s: MahjongGameState): ReplayResult {
  const settlement = s.settlement!;
  const list = s.winners?.length ? s.winners : s.winner ? [s.winner] : [];
  return {
    reason: settlement.reason,
    winners: list.map((w) => {
      const selfDraw = w.from == null;
      return { seat: w.seat, from: w.from ?? null, selfDraw, winTile: w.winTile?.id ?? null, fans: w.score.fans.map((f) => ({ name: f.name, value: f.value })), totalFan: w.score.totalFan };
    }),
    deltas: [...settlement.deltas],
    scores: s.playerScores ? [...s.playerScores] : null,
  };
}

/**
 * 每次存牌局狀態前呼叫（會改 s.replayLog）。這局剛結算時回傳整局紀錄，呼叫端存檔成功後寫進資料庫；其他時候回 null。
 * 上線前開局的房間（沒有 startedAt）不記。
 */
export function stepReplay(s: MahjongGameState, now: number = Date.now()): ReplayRecord | null {
  if (!s.startedAt || !Array.isArray(s.players) || s.players.length !== 4) return null;
  const done = s.handsCompleted ?? 0;
  const log = s.replayLog;

  if (s.status === "playing") {
    const n = done + 1;
    if (log && log.n === n && !log.done) { append(log, s, now); return null; }
    if (log && log.n === n && log.done) return null;
    // 新的一局：剛發完牌才開始記；打到一半才遇到（上線當下）就不記這局
    if (isFreshDeal(s)) s.replayLog = startLog(s, n, now);
    else delete s.replayLog;
    return null;
  }

  if (s.status === "finished" && s.settlement && done >= 1) {
    if (log && log.n === done && log.done) return null;
    let live: Extract<ReplayLog, { done?: false }>;
    if (log && log.n === done && !log.done) live = log;
    else if (isFreshDeal(s)) live = startLog(s, done, now); // 開局補花就胡（八仙過海、七搶一）：發牌和結算是同一次存檔
    else { delete s.replayLog; return null; }
    const result = resultOf(s);
    const finishTag = result.reason === "draw" ? "draw_game" : result.reason === "self_draw" ? "zimo" : "win";
    append(live, s, now, [finishTag]);
    const rec: ReplayRecord = {
      v: REPLAY_VERSION, hand: done, ...live.head, init: live.init, events: live.ev, result,
      durationMs: Math.max(0, now - live.at),
    };
    s.replayLog = { v: REPLAY_VERSION, n: done, done: true };
    return rec;
  }
  return null;
}

export function summaryOf(rec: ReplayRecord): ReplaySummary {
  return {
    hand: rec.hand, round: rec.round, game: rec.game, wind: rec.wind, dealer: rec.dealer,
    reason: rec.result.reason,
    winners: rec.result.winners.map((w) => ({ seat: w.seat, from: w.from, selfDraw: w.selfDraw, totalFan: w.totalFan })),
    deltas: rec.result.deltas,
    steps: rec.events.length,
    durationMs: rec.durationMs,
  };
}

let FACES: Tile[] | null = null;
/** 牌 id → 牌面（0～143） */
export function tileFace(id: number): Tile | null {
  FACES ??= buildTiles();
  return FACES[id] ?? null;
}

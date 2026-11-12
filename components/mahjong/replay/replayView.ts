// 麻將回放：把老柯的回放紀錄（lib/mahjong/replay/log.ts）換成牌桌元件（MjBoard／MjBoardMobile）要的 props。
// 純函式、不碰 React，測試見 tests/_replay-view.ts。牌桌元件原封不動，回放畫面才會和打牌時一模一樣。
import type { Tile } from "@/lib/mahjong/tiles";
import { sortTiles } from "@/lib/mahjong/tiles";
import type { Meld } from "@/lib/mahjong/gameState";
import type { MjOpponentHand, MjPlayer } from "@/hooks/useMahjong";
import { safeHand } from "@/lib/mahjong/handOrder";
import { tileFace, type MeldSnap, type ReplayView, type SeatSnap } from "@/lib/mahjong/replay/log";

export interface ReplayBoard {
  players: MjPlayer[];
  mySeat: number;
  myHand: Tile[];
  currentTurn: number;
  dealerSeat: number;
  lastDiscard: { tile: Tile; from: number } | null;
  focusDiscard: { tile: Tile; from: number } | null;
  tingSeats: number[];
  eyeSeats: number[];
  opponentHands: MjOpponentHand[] | null;
  wallRemaining: number;
  hasDrawn: boolean;
  drawnTileId: number | null;
  drawnSeat: number | null;
  playerScores?: number[];
  dice?: [number, number, number];
  doorSeat?: number;
  dealerConsecutive: number;
}

const face = (id: number): Tile => tileFace(id) as Tile; // tileFace 回傳的牌已經帶 id（tiles.ts buildTiles）
const faces = (ids: number[]) => ids.map(face);
const meld = (m: MeldSnap): Meld => {
  const [type, from, ...ids] = m;
  return { type: type as Meld["type"], tiles: faces(ids as number[]), ...(from >= 0 ? { from } : {}) };
};

/** 和牌局一樣（lib/mahjong/db.ts hideConcealedKongs）：別家的暗槓蓋著，牌面和 id 都不給；本人看自己的、眼牌的人走 opponentHands */
const hidden = (ms: Meld[], seat: number): Meld[] =>
  ms.map((m, mi) => (m.type === "concealed_kong"
    ? { ...m, tiles: m.tiles.map((_, k) => ({ id: -(10000 + seat * 100 + mi * 4 + k), suit: "z" as const, rank: 0, display: "" })) }
    : m));

/** 這一步剛真的摸進一張、還沒打出的座位和那張牌（眼牌自動摸打同一步打掉了就不算） */
function drawnAt(rec: ReplayView, frame: SeatSnap[], step: number): { seat: number; tileId: number } | null {
  const ev = rec.events[step - 1];
  if (!ev || !ev.k.includes("draw")) return null;
  for (const d of ev.p) {
    const added = d.ha ?? [];
    const last = added[added.length - 1];
    if (last == null) continue;
    const h = frame[d.s].h;
    if (h.length % 3 === 2 && h.includes(last)) return { seat: d.s, tileId: last };
  }
  return null;
}

/**
 * 第 step 步（0＝發完牌，i＝第 i 個事件之後）、從 seat 的視角看到的牌桌。
 * frames 是 replayFrames(rec) 的結果（呼叫端算一次重複用）。
 */
export function boardAt(rec: ReplayView, frames: SeatSnap[][], step: number, seat: number): ReplayBoard {
  const frame = frames[step];
  const last = step === rec.events.length;
  const before = rec.events.slice(0, step);
  const eyeSeats = [...new Set(before.flatMap((e) => e.e ?? []))];
  const tingSeats = [...new Set(before.flatMap((e) => e.ti ?? []))];
  const currentTurn = step === 0 ? rec.dealer : before[step - 1].c;
  const wallRemaining = step === 0 ? rec.init.wall.length : before[step - 1].w;

  // 海底和牌局狀態一樣：被吃碰槓走的牌、放槍胡走的那張不顯示（API.md「海底的顯示」）
  const taken = new Set(frame.flatMap((s) => s.m.flatMap((m) => m.slice(2) as number[])));
  if (last) for (const w of rec.result.winners) if (!w.selfDraw && w.winTile != null) taken.add(w.winTile);

  // 中間的大牌：最近打出、還在海底的那張；剛打出（這一步）才算 lastDiscard
  let focusDiscard: ReplayBoard["focusDiscard"] = null;
  let lastDiscard: ReplayBoard["lastDiscard"] = null;
  for (let j = step - 1; j >= 0; j--) {
    const d = before[j].p.find((x) => x.da?.length);
    if (!d) continue;
    const id = d.da![d.da!.length - 1];
    if (!taken.has(id)) {
      focusDiscard = { tile: face(id), from: d.s };
      if (j === step - 1) lastDiscard = focusDiscard;
    }
    break;
  }

  const drawn = drawnAt(rec, frame, step);
  const scoresAfter = rec.result.scores;
  const playerScores = scoresAfter ? (last ? scoresAfter : scoresAfter.map((v, i) => v - rec.result.deltas[i])) : undefined;

  const players: MjPlayer[] = frame.map((s, i) => ({
    id: `seat-${i}`,
    name: rec.seats.find((x) => x.seat === i)?.name ?? "",
    seat: i,
    tileCount: s.h.length,
    flowers: faces(s.f),
    discards: faces(s.d.filter((id) => !taken.has(id))),
    revealed: i === seat ? s.m.map(meld) : hidden(s.m.map(meld), i),
    isDealer: i === rec.dealer,
  }));

  // 打牌時只有眼牌的人看得到別家手牌，回放照同樣規則
  const opponentHands = eyeSeats.includes(seat)
    ? frame.flatMap((s, i) => (i === seat ? [] : [{
        seat: i,
        hand: sortTiles(faces(s.h)),
        revealed: s.m.map(meld),
        drawnTileId: drawn?.seat === i ? drawn.tileId : null,
      }]))
    : null;

  return {
    players,
    mySeat: seat,
    myHand: safeHand(faces(frame[seat].h)),
    currentTurn,
    dealerSeat: rec.dealer,
    lastDiscard,
    focusDiscard,
    tingSeats,
    eyeSeats,
    opponentHands,
    wallRemaining,
    hasDrawn: frame[currentTurn].h.length % 3 === 2,
    drawnTileId: drawn?.seat === seat ? drawn.tileId : null,
    drawnSeat: drawn?.seat ?? null,
    playerScores,
    dice: rec.dice?.length === 3 ? (rec.dice as [number, number, number]) : undefined,
    doorSeat: rec.door ?? undefined,
    dealerConsecutive: rec.dealerConsecutive,
  };
}

/** 播放時兩步之間等多久：照實際打牌的間隔，但最長 3 秒、最短 0.3 秒，再除以倍速 */
export function stepDelay(rec: ReplayView, step: number, speed: number): number {
  const a = step === 0 ? 0 : rec.events[step - 1].t;
  const b = rec.events[step]?.t ?? a;
  return Math.min(3000, Math.max(300, b - a)) / speed;
}

/** 毫秒 → mm:ss */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const taipei = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 到期文字（規格：>24 小時向上取整「剩 N 天到期」；0～24 小時「即將到期」＋台北時間「到期：11/20 14:30」） */
export function expiryText(expiresAt: string, now: number): { text: string; at: string | null } {
  const ms = Date.parse(expiresAt);
  if (ms - now > 86_400_000) return { text: `剩 ${Math.ceil((ms - now) / 86_400_000)} 天到期`, at: null };
  const p = Object.fromEntries(taipei.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { text: "即將到期", at: `到期：${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}` };
}

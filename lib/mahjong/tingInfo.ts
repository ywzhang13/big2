// 聽牌提示（老闆 2026-10-29）：打出每一張後聽哪些牌、每張還剩幾隻；眼牌後聽的牌各剩幾隻。
// 只吃「這位玩家自己拿得到的牌局畫面」（toPlayerGameState 給本人的那一份），伺服器不用多送任何東西：
//   ・眼牌前：自己的手牌、自己的吃碰槓（含暗槓）、各家海底、別家的吃碰明槓（別家的暗槓是蓋著的，不算）
//   ・眼牌後：再加上 opponentHands（只有眼牌的人才會收到，含別家手牌和暗槓牌面）
// 花牌不影響張數。純函式、不碰 React，前後端都能用（tests/_ting-info.ts）。
import { Tile, tileKey } from "./tiles";
import { Meld } from "./gameState";
import { findWaitingTiles } from "./winCheck";

export interface TingView {
  hand?: Tile[];
  players: { seat: number; revealed: Meld[]; discards: Tile[] }[];
  opponentHands?: { seat: number; hand: Tile[]; revealed: Meld[] }[];
}

export type WaitLeft = { key: string; left: number };
export type DiscardTing = { discard: string; waits: WaitLeft[]; total: number };

/** 這位玩家看得到的每種牌各幾張（tileKey → 張數） */
export function seenTileCounts(view: TingView, mySeat: number): Map<string, number> {
  const seen = new Map<string, number>();
  const add = (t: Tile) => { if (t.suit !== "f") seen.set(tileKey(t), (seen.get(tileKey(t)) ?? 0) + 1); };
  const opp = new Map((view.opponentHands ?? []).map((o) => [o.seat, o]));
  (view.hand ?? []).forEach(add);
  for (const p of view.players) {
    p.discards.forEach(add);
    const o = opp.get(p.seat);
    if (o) { o.hand.forEach(add); o.revealed.forEach((m) => m.tiles.forEach(add)); continue; }
    for (const m of p.revealed) if (p.seat === mySeat || m.type !== "concealed_kong") m.tiles.forEach(add);
  }
  return seen;
}

function waitsWithLeft(hand: Tile[], meldCount: number, seen: Map<string, number>): WaitLeft[] {
  return findWaitingTiles(hand, meldCount).map((key) => ({ key, left: Math.max(0, 4 - (seen.get(key) ?? 0)) }));
}

/** 現在的手牌聽哪些牌、各剩幾隻（眼牌後、或沒輪到自己時用） */
export function waitsLeft(view: TingView, mySeat: number): WaitLeft[] {
  const me = view.players.find((p) => p.seat === mySeat);
  const hand = (view.hand ?? []).filter((t) => t.suit !== "f");
  return waitsWithLeft(hand, me?.revealed.length ?? 0, seenTileCounts(view, mySeat));
}

/** 輪到自己要打牌時：打出每一種牌後聽哪些牌、各剩幾隻；打了不會聽的牌不列。同一種牌只列一次 */
export function discardTingOptions(view: TingView, mySeat: number): DiscardTing[] {
  const me = view.players.find((p) => p.seat === mySeat);
  const hand = (view.hand ?? []).filter((t) => t.suit !== "f");
  const seen = seenTileCounts(view, mySeat);
  const out: DiscardTing[] = [];
  for (const key of [...new Set(hand.map(tileKey))]) {
    const i = hand.findIndex((t) => tileKey(t) === key);
    const waits = waitsWithLeft([...hand.slice(0, i), ...hand.slice(i + 1)], me?.revealed.length ?? 0, seen);
    if (waits.length) out.push({ discard: key, waits, total: waits.reduce((a, w) => a + w.left, 0) });
  }
  return out;
}

// 補花特效的「已知花牌」基線（前端用，純邏輯、不碰 React）。
// 牌的 id 每局都會重複使用，所以基線一定要跟著局走：
//   開局事件 → 換成這局的花；輪詢發現是更新的一局（漏收開局事件）→ 也換成伺服器快照；
//   比目前舊的輪詢回應（晚到）→ 不碰基線；廣播事件 → 和基線比對，多出來的才播。
import type { RoundInfo } from "./gameState";
import type { Tile } from "./tiles";

export type GameKey = readonly [round: number, game: number, consecutive: number];

export function gameKeyOf(r: RoundInfo | null | undefined): GameKey | null {
  return r ? [r.currentRound, r.currentGame, r.dealerConsecutive] : null;
}

/** 圈→局→連莊依序比；每一局都會讓這組數字變大（連莊加 1；換莊局數加 1、連莊歸零；換圈圈數加 1） */
export function compareGameKey(a: GameKey, b: GameKey): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

type SeatFlowers = { seat: number; flowers: Tile[] };

export class FlowerTracker {
  private known = new Map<number, Set<number>>();
  private game: GameKey | null = null;

  /** 開局事件：基線換成這局的花，回傳每家要播的開局補花 */
  onGameStart(players: SeatFlowers[], round: RoundInfo | null | undefined): SeatFlowers[] {
    this.reset(players);
    this.game = gameKeyOf(round) ?? this.game;
    return players.filter((p) => p.flowers.length > 0);
  }

  /** 輪詢：只記不播。更新的一局（漏收開局事件）就整個換成快照；舊的回應不碰基線 */
  onPoll(players: SeatFlowers[], round: RoundInfo | null | undefined): void {
    const polled = gameKeyOf(round);
    if (polled && this.game) {
      const rel = compareGameKey(polled, this.game);
      if (rel < 0) return;
      if (rel > 0) { this.game = polled; this.reset(players); return; }
    }
    if (polled && !this.game) this.game = polled;
    for (const p of players) this.note(p.seat, p.flowers);
  }

  /** 廣播事件（摸牌、補花）：回傳這次新補的花；這家還沒記過（剛重新整理）就只記不播 */
  onEvent(seat: number, flowers: Tile[]): Tile[] {
    if (!this.known.has(seat)) { this.known.set(seat, new Set(flowers.map((t) => t.id))); return []; }
    return this.note(seat, flowers);
  }

  private note(seat: number, flowers: Tile[]): Tile[] {
    const known = this.known.get(seat);
    if (!known) { this.known.set(seat, new Set(flowers.map((t) => t.id))); return []; }
    const added = flowers.filter((t) => !known.has(t.id));
    added.forEach((t) => known.add(t.id));
    return added;
  }

  private reset(players: SeatFlowers[]) {
    this.known.clear();
    for (const p of players) this.known.set(p.seat, new Set(p.flowers.map((t) => t.id)));
  }
}

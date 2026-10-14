// 測試用：照真的發牌，發完後把花牌改成指定分配，再跑同一個開局花牌判斷
export * from "../../lib/mahjong/gameLogic";
import * as G from "../../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
export const force: { flowers: Record<number, number[]> | null } = { flowers: null };
function apply(s: MahjongGameState): MahjongGameState {
  if (!force.flowers) return s;
  s.status = "playing"; s.winners = undefined; s.winner = undefined; s.pendingFlowerRob = undefined;
  for (const p of s.players) {
    p.flowers = (force.flowers[p.seat] ?? []).map((r) => ({ id: 900 + r, suit: "f" as const, rank: r, display: "f" + r }));
  }
  return G.checkDealFlowerWin(s);
}
export function dealTiles(s: MahjongGameState) { return apply(G.dealTiles(s)); }
export function startNextGame(s: MahjongGameState) { return apply(G.startNextGame(s)); }

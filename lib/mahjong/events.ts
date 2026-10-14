// 各路由共用的「結算 + 廣播事件」組裝。只組資料，不存檔、不送出。

import {
  calculateSettlement,
  isAllRoundsComplete,
  ownTurnActions,
} from "./gameLogic";
import type { MahjongGameState } from "./gameState";

export type MjEvent = { event: string; payload: Record<string, unknown> };

/**
 * 牌局已結束（流局、八仙過海、七搶一…）：算結算、累加分數、判斷是否全部打完。
 * 會直接改 s，要在存檔「之前」呼叫。
 */
export function applySettlement(s: MahjongGameState): void {
  if (!s.roomSettings) return;
  const settlement = calculateSettlement(s);
  s.settlement = settlement;
  if (s.playerScores) {
    s.playerScores = s.playerScores.map((v, i) => v + settlement.deltas[i]);
  }
  s.gameOver = isAllRoundsComplete(s);
}

/** mj_game_over：有贏家照胡牌格式，沒有贏家就是流局（winnerSeat=-1） */
export function gameOverEvent(s: MahjongGameState): MjEvent {
  const winner = s.winners?.[0] ?? s.winner;
  return {
    event: "mj_game_over",
    payload: {
      winnerSeat: winner ? winner.seat : -1,
      winnerName: winner ? s.players[winner.seat].name : null,
      score: winner ? winner.score : null,
      winners: (s.winners ?? []).map((w) => ({
        seat: w.seat,
        name: s.players[w.seat].name,
        score: w.score,
      })),
      allHands: s.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        hand: p.hand,
        revealed: p.revealed,
        flowers: p.flowers,
      })),
      settlement: s.settlement,
      playerScores: s.playerScores,
      roundInfo: s.roundInfo,
      gameOver: s.gameOver,
    },
  };
}

/**
 * 摸牌或槓後補牌完成的廣播：公開 mj_draw（張數、花），私人 mj_draw_tile
 * （摸到的牌＋現在能做的自摸胡／暗槓／加槓）。七搶一等待中時另外通知。
 */
export function drawEvents(s: MahjongGameState, seat: number): MjEvent[] {
  const p = s.players[seat];
  const hand = p.hand.filter((t) => t.suit !== "f");
  const actions = ownTurnActions(s, seat);
  const kongOptions = actions.filter((a) => a.type === "kong").map((a) => a.tiles!.map((t) => t.id));
  const addKongOptions = actions.filter((a) => a.type === "add_kong").map((a) => a.tiles![0].id);
  const events: MjEvent[] = [
    {
      event: "mj_draw",
      payload: { seat, tileCount: p.hand.length, wallCount: s.wall.length, flowers: p.flowers },
    },
    {
      event: "mj_draw_tile",
      payload: {
        playerId: p.id,
        tile: hand[hand.length - 1],
        hand,
        flowers: p.flowers,
        canWin: actions.some((a) => a.type === "win"),
        canKong: kongOptions.length > 0,
        kongOptions,
        addKongOptions,
      },
    },
  ];
  events.push(...flowerRobEvents(s));
  return events;
}

/** 七搶一等待中：公開 mj_flower_rob_pending，並只給有 7 張花的人 win 選項 */
export function flowerRobEvents(s: MahjongGameState): MjEvent[] {
  const fr = s.pendingFlowerRob;
  if (!fr) return [];
  return [
    { event: "mj_flower_rob_pending", payload: { robberSeat: fr.robberSeat, fromSeat: fr.fromSeat, tile: fr.tile } },
    {
      event: "mj_available_actions",
      payload: {
        playerId: s.players[fr.robberSeat].id,
        actions: [{ type: "win", playerSeat: fr.robberSeat }],
        robFlower: true,
      },
    },
  ];
}

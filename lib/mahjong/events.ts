// 各路由共用的「結算 + 廣播事件」組裝。只組資料，不存檔、不送出。

import {
  allHands,
  advanceTurn,
  autoDiscardForTing,
  calculateSettlement,
  getAvailableActions,
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
  // 只有新版開局（有這個欄位）的場次才計數，上線前開局的房間維持沒有 → 不補記紀錄
  if (s.handsCompleted !== undefined) s.handsCompleted += 1;
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
      winners: (s.winners ?? []).map((w) => ({ ...w, name: s.players[w.seat].name })),
      allHands: allHands(s),
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
  const tingOptions = actions.find((a) => a.type === "declare_ting")?.tiles?.map((t) => t.id) ?? [];
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
        tingOptions,
      },
    },
  ];
  events.push(...flowerRobEvents(s));
  return events;
}

/**
 * 打牌後（discardTile 之後的狀態 s，seat 是打牌的人）：
 * 有人能吃碰槓胡就開窗口（pendingActions），沒有就輪到下一家。會直接改 s，要在存檔前呼叫。
 * auto=true 表示地聽後由伺服器自動打出。
 */
export function discardEvents(s: MahjongGameState, seat: number, auto = false): MjEvent[] {
  const actions = getAvailableActions(s);
  if (actions.length > 0) {
    s.pendingActions = {
      discardFrom: seat,
      potentialActors: [...new Set(actions.map((a) => a.playerSeat))],
      passedActors: [],
    };
  } else {
    Object.assign(s, advanceTurn(s));
    s.pendingActions = undefined;
  }
  const events: MjEvent[] = [
    {
      event: "mj_discard",
      payload: {
        seat,
        tile: s.lastDiscard!.tile,
        availableActions: actions.map((a) => ({ type: a.type, playerSeat: a.playerSeat })),
        ...(auto ? { auto: true } : {}),
      },
    },
  ];
  const tierOf = (type: string) =>
    type === "win" ? 0 : type === "pong" || type === "kong" ? 1 : 2;
  for (const actionSeat of new Set(actions.map((a) => a.playerSeat))) {
    const mine = actions.filter((a) => a.playerSeat === actionSeat);
    const otherTiers = actions.filter((a) => a.playerSeat !== actionSeat).map((a) => tierOf(a.type));
    const minOtherTier = otherTiers.length > 0 ? Math.min(...otherTiers) : 999;
    const filtered = mine.filter((a) => tierOf(a.type) <= minOtherTier);
    if (filtered.length === 0) continue;
    events.push({
      event: "mj_available_actions",
      payload: { playerId: s.players[actionSeat].id, actions: filtered },
    });
  }
  if (!s.pendingActions) {
    events.push({
      event: "mj_turn_advance",
      payload: { currentTurn: s.currentTurn, hasDrawn: s.hasDrawn },
    });
  }
  return events;
}

/**
 * 摸牌（或七搶一不搶）之後：輪到的人已地聽、又不能胡 → 伺服器自動打出摸到的牌。
 * 回傳 [自動打牌後的狀態, 打牌事件]；不需要自動打時回 null。要在存檔前呼叫。
 */
export function tingAutoDiscard(s: MahjongGameState): [MahjongGameState, MjEvent[]] | null {
  const seat = s.currentTurn;
  const next = autoDiscardForTing(s);
  if (!next) return null;
  return [next, discardEvents(next, seat, true)];
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

// 各路由共用的「結算 + 廣播事件」組裝。只組資料，不存檔、不送出。

import {
  allHands,
  advanceTurn,
  applyWinnerOrderRule,
  autoDiscardForTing,
  calculateSettlement,
  declareWin,
  getAvailableActions,
  isAllRoundsComplete,
  isLocked,
  ownTurnActions,
  robFlower,
} from "./gameLogic";
import type { MahjongGameState } from "./gameState";
import { sortTiles, type Tile } from "./tiles";

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
  const eye = actions.find((a) => a.type === "declare_eye");
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
        eyeOptions: eye?.tiles?.map((t) => t.id) ?? [],
        eyeWithTing: !!eye?.ting,
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

// ---------------------------------------------------------------------------
// 眼牌
// ---------------------------------------------------------------------------

/** 這局有人胡了、沒有其他人要決定：定案贏家順序、結束、結算。會直接改 s */
function finishWithWinners(s: MahjongGameState): MahjongGameState {
  const done = applyWinnerOrderRule(s);
  done.status = "finished";
  done.pendingActions = undefined;
  done.pendingAddKong = undefined;
  applySettlement(done);
  return done;
}

export type EyeAutoplay = {
  s: MahjongGameState;
  events: MjEvent[];
  finished: boolean;
  autoDiscarded?: Tile;
};

/**
 * 替眼牌的人做決定（每次存檔前呼叫）：
 *   - 能胡別人打的牌（含搶槓）→ 自動胡；還有不是眼牌的人能胡同一張（一砲多響）就等他們決定
 *   - 自己摸到能胡 → 自動自摸；不能胡（或過水中）→ 自動打出摸到的牌，再看別的眼牌者能不能胡這張
 *   - 七搶一輪到眼牌的人決定 → 自動搶
 * 地聽的人（舊版宣告、沒有眼牌）照舊：只自動打牌，胡要自己按。
 */
export function eyeAutoplay(input: MahjongGameState): EyeAutoplay {
  let s = input;
  const events: MjEvent[] = [];
  let autoDiscarded: Tile | undefined;
  const isEye = (seat: number) => !!s.eyeSeats?.includes(seat);
  for (let guard = 0; guard < 8 && s.status === "playing"; guard++) {
    if (s.pendingFlowerRob) {
      if (!isEye(s.pendingFlowerRob.robberSeat)) break;
      s = robFlower(s);
      applySettlement(s);
      return { s, events: [...events, gameOverEvent(s)], finished: true, autoDiscarded };
    }
    const pa = s.pendingActions;
    if (s.lastDiscard && pa) {
      const undecided = (seat: number) => pa.potentialActors.includes(seat) && !pa.passedActors.includes(seat);
      const winSeats = [...new Set(getAvailableActions(s).filter((a) => a.type === "win").map((a) => a.playerSeat))].filter(undecided);
      const eyeWinners = winSeats.filter(isEye);
      if (eyeWinners.length === 0) break;
      for (const seat of eyeWinners) s = declareWin(s, seat, false);
      s.pendingActions = { ...pa, passedActors: [...pa.passedActors, ...eyeWinners] };
      if (winSeats.some((x) => !isEye(x))) {
        // 一砲多響：還有人能胡同一張，等他們胡或 pass（和手動胡的部分結果同一個事件）
        for (const seat of eyeWinners) {
          const w = s.winners!.find((x) => x.seat === seat)!;
          events.push({ event: "mj_partial_win", payload: { seat, winnerName: s.players[seat].name, score: w.score } });
        }
        break;
      }
      s = finishWithWinners(s);
      return { s, events: [...events, gameOverEvent(s)], finished: true, autoDiscarded };
    }
    const seat = s.currentTurn;
    if (!isLocked(s, seat) || !s.hasDrawn || s.drawnTileId === undefined || s.lastDiscard || pa || s.pendingAddKong) break;
    if (isEye(seat) && ownTurnActions(s, seat).some((a) => a.type === "win")) {
      s = finishWithWinners(declareWin(s, seat, true));
      return { s, events: [...events, gameOverEvent(s)], finished: true, autoDiscarded };
    }
    const next = autoDiscardForTing(s);
    if (!next) break;
    s = next;
    autoDiscarded = s.lastDiscard!.tile;
    events.push(...discardEvents(s, seat, true));
  }
  return { s, events, finished: false, autoDiscarded };
}

/** 眼牌的人看到的其他三家手牌（排序好、不含花）；摸進還沒打的那張用 drawnTileId 指出 */
export function opponentHands(s: MahjongGameState, eyeSeat: number) {
  return s.players
    .filter((p) => p.seat !== eyeSeat)
    .map((p) => ({
      seat: p.seat,
      hand: sortTiles(p.hand.filter((t) => t.suit !== "f")),
      revealed: p.revealed, // 吃碰槓，暗槓含牌面
      drawnTileId: s.currentTurn === p.seat && s.hasDrawn ? (s.drawnTileId ?? null) : null,
    }));
}

/** 每次狀態改變後送給每位眼牌者（只送到本人座位頻道）的三家手牌 */
export function eyeViewEvents(s: MahjongGameState): MjEvent[] {
  if (s.status !== "playing") return [];
  return (s.eyeSeats ?? []).map((seat) => ({
    event: "mj_opponent_hands",
    payload: { playerId: s.players[seat].id, opponentHands: opponentHands(s, seat) },
  }));
}

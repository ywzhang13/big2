import {
  loadRoom,
  saveGameStateIfUnchanged,
  findSeatByPlayerId,
  retryOnConflict,
} from "@/lib/mahjong/db";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { drawTile, ownTurnActions } from "@/lib/mahjong/gameLogic";
import { applySettlement, drawEvents, gameOverEvent, tingAutoDiscard } from "@/lib/mahjong/events";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongIfOver } from "@/lib/records/close";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleDraw(body, fresh));
}

async function handleDraw(body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId } = body as {
    roomId?: string;
    playerId?: string;
  };

  if (!roomId || !playerId) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  // Load room and state
  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }

  const state = room.game_state as MahjongGameState;
  if (state.status !== "playing") {
    return Response.json({ error: "遊戲未在進行中" }, { status: 400 });
  }

  // Verify turn
  const seat = findSeatByPlayerId(state, playerId);
  if (seat === -1) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }
  if (state.currentTurn !== seat) {
    return Response.json({ error: "還沒輪到你" }, { status: 400 });
  }
  if (state.hasDrawn) {
    return Response.json({ error: "已經摸過牌了" }, { status: 400 });
  }

  // Don't allow draw if there are pending actions (chi/pong/kong in progress)
  if (state.pendingActions && state.pendingActions.potentialActors.length > 0) {
    const allPassed = state.pendingActions.potentialActors.every(
      (s) => state.pendingActions!.passedActors.includes(s)
    );
    if (!allPassed) {
      return Response.json({ error: "等待其他玩家動作中" }, { status: 400 });
    }
  }

  // Draw tile（含補花；可能流局、八仙過海，或進入七搶一等待）
  const newState = drawTile(state);

  if (newState.status === "finished") {
    applySettlement(newState);
    await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, "finished");
    await mjBroadcastBatch(room.code, [gameOverEvent(newState)]);
    await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
    return Response.json({ success: true, draw: !newState.winners?.length });
  }

  const events = drawEvents(newState, seat);
  // 地聽的人摸到不能胡的牌：伺服器直接幫他打出這張
  const auto = tingAutoDiscard(newState);
  await saveGameStateIfUnchanged(roomId, state.stateVersion, auto ? auto[0] : newState);
  await mjBroadcastBatch(room.code, auto ? [...events, ...auto[1]] : events);

  const player = newState.players[seat];
  const actions = ownTurnActions(newState, seat);
  return Response.json({
    success: true,
    drawnTile: player.hand[player.hand.length - 1],
    canWin: actions.some((a) => a.type === "win"),
    canKong: actions.some((a) => a.type === "kong"),
    addKongOptions: actions.filter((a) => a.type === "add_kong").map((a) => a.tiles![0].id),
    flowerRob: !!newState.pendingFlowerRob,
    autoDiscarded: auto ? auto[0].lastDiscard!.tile : null,
  });
}

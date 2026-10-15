import {
  loadRoom,
  saveGameStateIfUnchanged,
  toPublicGameState,
  retryOnConflict,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast, mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { applySettlement, flowerRobEvents, gameOverEvent } from "@/lib/mahjong/events";
import { startNextGame, isAllRoundsComplete, tingDiscardOptions } from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongIfOver } from "@/lib/records/close";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleNextGame(request, body, fresh));
}

async function handleNextGame(request: Request, body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId } = body as {
    roomId?: string;
    playerId?: string;
  };

  if (!roomId || !playerId) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  // Load room
  const room = await loadRoom(roomId, { fresh });
  if (!room) {
    return Response.json({ error: "找不到房間" }, { status: 404 });
  }
  // 確認是這個座位的本人（一律要登入）
  const denied = await seatOwnerError(request, room.game_state, playerId);
  if (denied) return denied;

  const state = room.game_state as MahjongGameState;
  if (state.status !== "finished") {
    return Response.json({ error: "目前的局還沒結束" }, { status: 400 });
  }

  if (!state.roomSettings || !state.roundInfo) {
    return Response.json({ error: "此房間沒有設定圈數" }, { status: 400 });
  }

  if (isAllRoundsComplete(state)) {
    return Response.json({ error: "所有圈數已結束" }, { status: 400 });
  }

  // Verify player is in the room
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }

  // Single-phase: each player clicks 同意 once. When all 4 have clicked,
  // next game starts immediately.
  const ready = new Set(state.nextGameReady ?? []);
  ready.add(playerId);
  const readyList = Array.from(ready);

  if (readyList.length < 4) {
    const partialState: MahjongGameState = {
      ...state,
      nextGameReady: readyList,
    };
    await saveGameStateIfUnchanged(roomId, state.stateVersion, partialState);
    await mjBroadcast(room.code, "mj_next_game_ready", {
      readyIds: readyList,
    });
    return Response.json({ success: true, ready: readyList.length, total: 4 });
  }

  // All 4 ready — start next game immediately
  const clearedState: MahjongGameState = {
    ...state,
    nextGameReady: [],
  };
  const newState = startNextGame(clearedState);

  // Save full state to DB
  // 開局補花就八仙過海：這局直接結束（先照常送開局事件，最後送 mj_game_over）
  const endedAtDeal = newState.status === "finished";
  if (endedAtDeal) applySettlement(newState);
  await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, endedAtDeal ? "finished" : "playing");

  // Broadcast public game start
  const publicState = toPublicGameState(newState);
  await mjBroadcast(room.code, "mj_game_start", {
    currentTurn: publicState.currentTurn,
    dealerSeat: publicState.dealerSeat,
    prevalentWind: publicState.prevalentWind,
    wallCount: publicState.wallCount,
    players: publicState.players,
    roundInfo: newState.roundInfo,
    playerScores: newState.playerScores,
    dice: newState.dice,
    doorSeat: newState.doorSeat,
  });

  // Send each player their hand privately
  for (const p of newState.players) {
    await mjBroadcast(room.code, "mj_deal_hand", {
      playerId: p.id,
      hand: p.hand.filter((t) => t.suit !== "f"),
      flowers: p.flowers,
      // 開局莊家打第一張時可以宣告地聽：能宣告的出牌選項（其他人是空陣列）
      tingOptions: tingDiscardOptions(newState, p.seat).map((t) => t.id),
    });
  }

  // 開局就八仙過海 → 結束；開局就 7＋1 張花 → 等有 7 張的人決定要不要七搶一
  await mjBroadcastBatch(room.code, endedAtDeal ? [gameOverEvent(newState)] : flowerRobEvents(newState));
  if (endedAtDeal) await closeMahjongIfOver(roomId, room.code, newState); // 最後一局開局就八仙：整場打完

  return Response.json({ success: true, ready: 4, total: 4, started: true });
}

import { loadRoom, saveGameState, toPublicGameState } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { startNextGame, isAllRoundsComplete } from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { withRoomLock } from "@/lib/mahjong/cache";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId } = body as {
      roomId?: string;
      playerId?: string;
    };

    if (!roomId || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    return await withRoomLock(roomId, async () => {
    // Load room
    const room = await loadRoom(roomId);
    if (!room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

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
      await saveGameState(roomId, partialState);
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
    await saveGameState(roomId, newState, "playing");

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
      });
    }

    return Response.json({ success: true, ready: 4, total: 4, started: true });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}

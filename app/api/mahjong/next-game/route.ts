import { loadRoom, saveGameState, toPublicGameState } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { startNextGame, isAllRoundsComplete } from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";

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

    // Two-phase flow:
    //   Phase 1: first click by each player → add to readyList
    //            when readyList hits 4, broadcast allReady (do NOT start yet)
    //   Phase 2: second click by anyone already in readyList → actually start
    const ready = new Set(state.nextGameReady ?? []);
    const alreadyReady = ready.has(playerId);
    ready.add(playerId);
    const readyList = Array.from(ready);
    const allReady = readyList.length >= 4;

    // Phase 1: still collecting votes
    if (!allReady) {
      const partialState: MahjongGameState = {
        ...state,
        nextGameReady: readyList,
      };
      await saveGameState(roomId, partialState);
      await mjBroadcast(room.code, "mj_next_game_ready", {
        readyIds: readyList,
        allReady: false,
      });
      return Response.json({ success: true, ready: readyList.length, total: 4 });
    }

    // All 4 ready: if this is the player's first click (fourth approval)
    // just broadcast allReady and keep the settlement visible. Anyone can
    // click "開始下一局" afterwards to actually transition.
    if (!alreadyReady) {
      const partialState: MahjongGameState = {
        ...state,
        nextGameReady: readyList,
      };
      await saveGameState(roomId, partialState);
      await mjBroadcast(room.code, "mj_next_game_ready", {
        readyIds: readyList,
        allReady: true,
      });
      return Response.json({ success: true, ready: 4, total: 4, allReady: true });
    }

    // Phase 2: player already in ready list + all ready → actually start
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}

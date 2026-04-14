import { loadRoom, loadPlayers, saveGameState, toPublicGameState } from "@/lib/mahjong/db";
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

    // Verify host
    if (room.host_id !== playerId) {
      return Response.json({ error: "只有房主可以開始下一局" }, { status: 403 });
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

    // Start next game
    const newState = startNextGame(state);

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
    for (const player of newState.players) {
      await mjBroadcast(room.code, "mj_deal_hand", {
        playerId: player.id,
        hand: player.hand.filter((t) => t.suit !== "f"),
        flowers: player.flowers,
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}

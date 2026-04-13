import { loadRoom, loadPlayers, saveGameState, toPublicGameState } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { initGame, dealTiles } from "@/lib/mahjong/gameLogic";

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
      return Response.json({ error: "只有房主可以開始遊戲" }, { status: 403 });
    }

    if (room.status !== "waiting") {
      return Response.json({ error: "遊戲已開始" }, { status: 400 });
    }

    // Load players
    const players = await loadPlayers(roomId);
    if (players.length !== 4) {
      return Response.json({ error: "需要 4 位玩家才能開始" }, { status: 400 });
    }

    // Initialize game
    const playerInfos = players.map((p) => ({
      id: p.player_id,
      name: p.name,
    }));

    let state = initGame(playerInfos);
    state.roomCode = room.code;
    state = dealTiles(state);

    // Save full state to DB
    await saveGameState(roomId, state, "playing");

    // Broadcast public game start (no hands)
    const publicState = toPublicGameState(state);
    await mjBroadcast(room.code, "mj_game_start", {
      currentTurn: publicState.currentTurn,
      dealerSeat: publicState.dealerSeat,
      prevalentWind: publicState.prevalentWind,
      wallCount: publicState.wallCount,
      players: publicState.players,
    });

    // Send each player their hand privately (defensive: filter flowers from hand)
    for (const player of state.players) {
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

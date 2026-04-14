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

    // Initialize game — pass room settings if present
    const playerInfos = players.map((p) => ({
      id: p.player_id,
      name: p.name,
    }));

    const savedSettings = (room.game_state as unknown as Record<string, unknown>)?.roomSettings as
      | { totalRounds: number; basePoints: number; fanPoints: number }
      | undefined;

    let state = initGame(playerInfos, savedSettings);
    state.roomCode = room.code;

    // 第一局：從建房者開始逆時針數，第一把骰子點數決定第一個莊家
    const hostSeat = state.players.findIndex((p) => p.id === room.host_id);
    const baseSeat = hostSeat >= 0 ? hostSeat : 0;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const d3 = 1 + Math.floor(Math.random() * 6);
    const sum = d1 + d2 + d3;
    const firstDealerSeat = (baseSeat + ((sum - 1) % 4)) % 4;
    state.dealerSeat = firstDealerSeat;
    if (state.roundInfo) {
      state.roundInfo.initialDealerSeat = firstDealerSeat;
    }

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
      roundInfo: state.roundInfo,
      playerScores: state.playerScores,
      dice: state.dice,
      doorSeat: state.doorSeat,
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

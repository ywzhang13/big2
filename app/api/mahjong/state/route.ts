import { loadRoom, toPlayerGameState, toPublicGameState } from "@/lib/mahjong/db";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");
    const playerId = searchParams.get("playerId");

    if (!roomId) {
      return Response.json({ error: "缺少 roomId" }, { status: 400 });
    }

    // Load room
    const room = await loadRoom(roomId);
    if (!room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // If no game state yet, return room info only
    if (!room.game_state) {
      return Response.json({
        roomId: room.id,
        code: room.code,
        status: room.status,
        gameState: null,
      });
    }

    const state = room.game_state as MahjongGameState;

    // If playerId provided, return their hand; otherwise public-only view
    if (playerId) {
      const playerView = toPlayerGameState(state, playerId);
      return Response.json({
        roomId: room.id,
        code: room.code,
        status: room.status,
        gameState: playerView,
      });
    }

    // Public view only (no hands)
    const publicView = toPublicGameState(state);
    return Response.json({
      roomId: room.id,
      code: room.code,
      status: room.status,
      gameState: publicView,
    });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}

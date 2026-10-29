import { loadRoom, loadPlayers, toPlayerGameState, toPublicGameState } from "@/lib/mahjong/db";
import { endedResponse } from "@/lib/records/close";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { privateChannelName, seatOwnerError } from "@/lib/mahjong/access";
import { viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate } from "@/lib/mahjong/spectate/store";

/** 每位玩家的被觀戰人數（名牌旁的眼睛；同桌每個人都看得到）。查不到不擋 state，前端等 mj_spectators 廣播再補 */
async function spectatorCounts(roomId: string, state: MahjongGameState): Promise<Record<string, number> | undefined> {
  try {
    return viewerCounts(await loadRoomSpectate(roomId), state.players.map((p) => p.id));
  } catch (err) {
    console.error("[mj-spectate] state counts", err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");
    const playerId = searchParams.get("playerId");

    if (!roomId) {
      return Response.json({ error: "缺少 roomId" }, { status: 400 });
    }

    const room = await loadRoom(roomId);
    if (!room) {
      // 房間已在這場結束後刪除：回「這場已結束」和總結算（410），前端不要顯示錯誤畫面
      const ended = await endedResponse("mahjong", { roomId });
      if (ended) return ended;
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // If no game state yet (still in lobby), return players from DB
    if (!room.game_state || !(room.game_state as unknown as Record<string, unknown>).status) {
      const dbPlayers = await loadPlayers(roomId);
      // Extract roomSettings if they were saved at room creation
      const savedSettings = (room.game_state as unknown as Record<string, unknown>)?.roomSettings;
      return Response.json({
        roomId: room.id,
        code: room.code,
        status: room.status,
        hostId: room.host_id,
        lobbyPlayers: (dbPlayers || []).map((p: { player_id: string; name: string; seat: number }) => ({
          id: p.player_id,
          name: p.name,
          seat: p.seat,
        })),
        roomSettings: savedSettings ?? null,
        gameState: null,
      });
    }

    const state = room.game_state as MahjongGameState;

    if (playerId) {
      // 只有座位本人看得到這個座位的手牌
      const denied = await seatOwnerError(request, state, playerId);
      if (denied) return denied;
      const playerView = toPlayerGameState(state, playerId);
      // 本人的座位頻道（重新整理後重新訂閱）
      Object.assign(playerView, { myChannel: privateChannelName(room.code, playerId), spectatorCounts: await spectatorCounts(room.id, state) });
      return Response.json({
        roomId: room.id,
        code: room.code,
        status: room.status,
        hostId: room.host_id,
        gameState: playerView,
      });
    }

    const publicView = { ...toPublicGameState(state), spectatorCounts: await spectatorCounts(room.id, state) };
    return Response.json({
      roomId: room.id,
      code: room.code,
      status: room.status,
      hostId: room.host_id,
      gameState: publicView,
    });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}

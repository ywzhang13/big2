import { loadRoom, saveGameState } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
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

    const room = await loadRoom(roomId);
    if (!room || !room.game_state) {
      return Response.json({ error: "找不到遊戲" }, { status: 404 });
    }

    const state = room.game_state as MahjongGameState;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
      return Response.json({ error: "玩家不在此房間" }, { status: 403 });
    }

    if (state.leaveRequest) {
      return Response.json(
        { error: "已有離開請求進行中" },
        { status: 409 }
      );
    }

    const newState: MahjongGameState = {
      ...state,
      leaveRequest: {
        requesterId: playerId,
        requesterName: player.name,
        requesterSeat: player.seat,
        approvedBy: [],
        deniedBy: [],
      },
    };
    await saveGameState(roomId, newState);

    await mjBroadcast(room.code, "mj_leave_request", {
      requesterId: playerId,
      requesterName: player.name,
      requesterSeat: player.seat,
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}

import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleLeaveRequest(request, body, fresh));
}

async function handleLeaveRequest(request: Request, body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId } = body as {
    roomId?: string;
    playerId?: string;
  };
  if (!roomId || !playerId) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }
  // 確認是這個座位的本人（一律要登入）
  const denied = await seatOwnerError(request, room.game_state, playerId);
  if (denied) return denied;

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
  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState);

  await mjBroadcast(room.code, "mj_leave_request", {
    requesterId: playerId,
    requesterName: player.name,
    requesterSeat: player.seat,
  }, sv);

  return Response.json({ success: true });
}

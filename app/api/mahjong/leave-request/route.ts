import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { decideLeave, idleSeatsOf } from "@/lib/mahjong/leave/dissolve";

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

  const leaveRequest = {
    requesterId: playerId,
    requesterName: player.name,
    requesterSeat: player.seat,
    approvedBy: [] as string[],
    deniedBy: [] as string[],
  };
  // 其他三家都超過 3 分鐘沒操作（不計票）→ 發起者本人有在操作，直接解散（老闆 2026-11-13，規則見 lib/mahjong/leave/rules.ts；原子解散見 dissolve.ts）
  const d = await decideLeave(roomId, room.code, state, { ...state, leaveRequest });
  if (d.kind === "gone") return Response.json({ error: "找不到遊戲" }, { status: 404 });
  if (d.kind === "closed") return Response.json({ success: true, result: "granted", needed: d.e.needed });
  const e = d.e;
  const newState: MahjongGameState = { ...state, leaveRequest };
  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState);

  await mjBroadcast(room.code, "mj_leave_request", {
    requesterId: playerId,
    requesterName: player.name,
    requesterSeat: player.seat,
    needed: e.needed,
    idleSeats: idleSeatsOf(e),
  }, sv);

  return Response.json({ success: true, result: "vote", needed: e.needed });
}

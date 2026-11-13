import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongRoom } from "@/lib/records/close";
import { evaluateLeave } from "@/lib/mahjong/leave/rules";
import { socialActivity } from "@/lib/mahjong/leave/activity";

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
  // 其他三家都超過 3 分鐘沒操作（不計票）→ 發起者本人有在操作，直接解散（老闆 2026-11-13，規則見 lib/mahjong/leave/rules.ts）
  const e = evaluateLeave({ ...state, leaveRequest }, Date.now(), await socialActivity(roomId, state))!;
  const granted = e.result === "granted";
  const newState: MahjongGameState = granted
    ? { ...state, leaveRequest: undefined, status: "finished" }
    : { ...state, leaveRequest };
  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, newState.status);

  await mjBroadcast(room.code, "mj_leave_request", {
    requesterId: playerId,
    requesterName: player.name,
    requesterSeat: player.seat,
    needed: e.needed,
    idleSeats: e.idle.map((x) => ({ seat: x.seat, name: x.name, idleSec: Math.floor(x.idleMs / 1000) })),
  }, sv);
  if (granted) {
    // 和投票解散同一個事件，前端照原本的「解散」處理
    await mjBroadcast(room.code, "mj_leave_vote", {
      voterId: playerId, voterSeat: player.seat, approve: null, approvedCount: 0, deniedCount: 0, result: "granted",
      requesterSeat: player.seat, requesterName: player.name, needed: 0,
      idleSeats: e.idle.map((x) => ({ seat: x.seat, name: x.name, idleSec: Math.floor(x.idleMs / 1000) })),
    }, sv);
    await closeMahjongRoom(roomId, room.code, newState, "dissolved");
  }

  return Response.json({ success: true, result: granted ? "granted" : "vote", needed: e.needed });
}

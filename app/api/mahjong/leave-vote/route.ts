import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongRoom } from "@/lib/records/close";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleLeaveVote(body, fresh));
}

async function handleLeaveVote(body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId, approve } = body as {
    roomId?: string;
    playerId?: string;
    approve?: boolean;
  };
  if (!roomId || !playerId || approve === undefined) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }

  const state = room.game_state as MahjongGameState;
  if (!state.leaveRequest) {
    return Response.json({ error: "沒有離開請求" }, { status: 400 });
  }

  // Voter can't be the requester
  if (state.leaveRequest.requesterId === playerId) {
    return Response.json({ error: "不能投給自己" }, { status: 403 });
  }
  const voter = state.players.find((p) => p.id === playerId);
  if (!voter) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }

  const lr = { ...state.leaveRequest };

  if (approve) {
    if (!lr.approvedBy.includes(playerId)) {
      lr.approvedBy = [...lr.approvedBy, playerId];
    }
  } else {
    // Any deny cancels the leave
    lr.deniedBy = [...lr.deniedBy, playerId];
  }

  const totalOthers = 3; // 3 other players
  const approved = lr.approvedBy.length;
  const denied = lr.deniedBy.length;

  let broadcastEvent: "granted" | "denied" | "vote" = "vote";
  let newState: MahjongGameState;

  if (denied > 0) {
    // Denied — cancel the request
    newState = { ...state, leaveRequest: undefined };
    broadcastEvent = "denied";
  } else if (approved >= totalOthers) {
    // All approved — end the game so everyone returns to lobby
    newState = {
      ...state,
      leaveRequest: undefined,
      status: "finished",
    };
    broadcastEvent = "granted";
  } else {
    // Partial — still waiting
    newState = { ...state, leaveRequest: lr };
  }

  await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, newState.status);

  await mjBroadcast(room.code, "mj_leave_vote", {
    voterId: playerId,
    voterSeat: voter.seat,
    approve,
    approvedCount: approved,
    deniedCount: denied,
    result: broadcastEvent, // "granted" | "denied" | "vote"
    requesterSeat: lr.requesterSeat,
    requesterName: lr.requesterName,
  });

  // 四家同意解散：打過至少一局就記下當下總分（中途解散），再關房；一局都沒打完的直接刪
  if (broadcastEvent === "granted") {
    await closeMahjongRoom(roomId, room.code, newState, "dissolved");
  }

  return Response.json({ success: true, result: broadcastEvent });
}

import { loadRoom, saveGameState } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId, approve } = body as {
      roomId?: string;
      playerId?: string;
      approve?: boolean;
    };
    if (!roomId || !playerId || approve === undefined) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    const room = await loadRoom(roomId);
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

    await saveGameState(roomId, newState, newState.status);

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

    return Response.json({ success: true, result: broadcastEvent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}

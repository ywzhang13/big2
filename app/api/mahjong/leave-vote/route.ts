// 解散投票（老闆 2026-11-13 起：超過 3 分鐘沒操作的玩家不計票，規則見 lib/mahjong/leave/rules.ts）
//   POST { roomId, playerId, approve: boolean }：投票（投票本身也算操作，閒置的人投票就恢復投票權）
//   POST { roomId, playerId, check: true }：發起者「重新確認」——有人在等待期間變成閒置時，用這個重新判斷能不能解散
//                                          （判斷結果沒變就不存檔，所以自動重試不會讓發起者一直算成「有操作」）
//   GET  ?roomId=&playerId=：目前的投票狀態（需要幾人同意、已同意幾人、哪些人閒置不計票），給投票畫面顯示；只讀
// 解散時照原本的中途解散流程：打過至少一局就記下當下總分，再關房。
import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongRoom } from "@/lib/records/close";
import { evaluateLeave, IDLE_VOTE_MS, restoreActive, type LeaveEval } from "@/lib/mahjong/leave/rules";
import { socialActivity } from "@/lib/mahjong/leave/activity";

const view = (e: LeaveEval) => ({
  needed: e.needed, approvedCount: e.approvedCount, deniedCount: e.deniedCount,
  idleSeats: e.idle.map((x) => ({ seat: x.seat, name: x.name, idleSec: Math.floor(x.idleMs / 1000) })),
  idleAfterSec: IDLE_VOTE_MS / 1000,
});

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const roomId = q.get("roomId"), playerId = q.get("playerId");
  if (!roomId || !playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  const room = await loadRoom(roomId);
  if (!room || !room.game_state) return Response.json({ error: "找不到遊戲" }, { status: 404 });
  const before = (room.game_state as MahjongGameState).lastActive?.[playerId];
  const notOwner = await seatOwnerError(request, room.game_state, playerId);
  if (notOwner) return notOwner;
  const s = room.game_state as MahjongGameState;
  restoreActive(s, playerId, before); // 看狀態不算操作：還原 seatOwnerError 順手記的時間（這份也不會存檔）
  const e = evaluateLeave(s, Date.now(), await socialActivity(roomId, s));
  if (!e || !s.leaveRequest) return Response.json({ active: false });
  return Response.json({ active: true, requesterSeat: s.leaveRequest.requesterSeat, ...view(e) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleLeaveVote(request, body, fresh));
}

async function handleLeaveVote(request: Request, body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId, approve, check } = body as {
    roomId?: string;
    playerId?: string;
    approve?: boolean;
    check?: boolean;
  };
  if (!roomId || !playerId || (approve === undefined && check !== true)) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }
  const before = (room.game_state as MahjongGameState).lastActive?.[playerId];
  // 確認是這個座位的本人（一律要登入）；同時記下這次操作的時間
  const notOwner = await seatOwnerError(request, room.game_state, playerId);
  if (notOwner) return notOwner;

  const state = room.game_state as MahjongGameState;
  if (!state.leaveRequest) {
    return Response.json({ error: "沒有離開請求" }, { status: 400 });
  }
  const voter = state.players.find((p) => p.id === playerId);
  if (!voter) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }

  const lr = { ...state.leaveRequest };
  if (check) {
    // 重新確認只給發起者；不算操作（還原剛剛順手記的時間）
    if (lr.requesterId !== playerId) return Response.json({ error: "只有發起者可以重新確認" }, { status: 403 });
    restoreActive(state, playerId, before);
  } else {
    if (lr.requesterId === playerId) {
      return Response.json({ error: "不能投給自己" }, { status: 403 });
    }
    if (approve) {
      if (!lr.approvedBy.includes(playerId)) lr.approvedBy = [...lr.approvedBy, playerId];
    } else {
      lr.deniedBy = [...lr.deniedBy, playerId]; // 任何一位（有在操作的人）不同意就取消
    }
  }

  const evalState: MahjongGameState = { ...state, leaveRequest: lr };
  const e = evaluateLeave(evalState, Date.now(), await socialActivity(roomId, state))!;
  const broadcastEvent = e.result;

  // 重新確認、結果沒變：什麼都不存、不廣播
  if (check && broadcastEvent === "vote") return Response.json({ success: true, result: "vote", ...view(e) });

  let newState: MahjongGameState;
  if (broadcastEvent === "denied") newState = { ...state, leaveRequest: undefined };
  else if (broadcastEvent === "granted") newState = { ...state, leaveRequest: undefined, status: "finished" };
  else newState = { ...state, leaveRequest: lr };

  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, newState.status);

  await mjBroadcast(room.code, "mj_leave_vote", {
    voterId: playerId,
    voterSeat: voter.seat,
    approve: check ? null : approve,
    approvedCount: e.approvedCount,
    deniedCount: e.deniedCount,
    result: broadcastEvent, // "granted" | "denied" | "vote"
    requesterSeat: lr.requesterSeat,
    requesterName: lr.requesterName,
    needed: e.needed,
    idleSeats: view(e).idleSeats,
  }, sv);

  // 解散：打過至少一局就記下當下總分（中途解散），再關房；一局都沒打完的直接刪
  if (broadcastEvent === "granted") {
    await closeMahjongRoom(roomId, room.code, newState, "dissolved");
  }

  return Response.json({ success: true, result: broadcastEvent, ...view(e) });
}

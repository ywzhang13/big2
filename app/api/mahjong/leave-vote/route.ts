// 解散投票（老闆 2026-11-13 定案：輪到他的牌局動作超過 3 分鐘沒做，就不計票；規則見 lib/mahjong/leave/rules.ts）
//   POST { roomId, playerId, approve: boolean }：投票（投票不是牌局動作：卡住的人投票不會恢復投票權，他的票也不計）
//   POST { roomId, playerId, check: true }：發起者「重新確認」——等待期間有人卡住超過時間，用這個重新判斷能不能解散（結果沒變就不存檔）
//   GET  ?roomId=&playerId=：目前的投票狀態（需要幾人同意、已同意幾人、哪些人卡住不計票），給投票畫面顯示；只讀
// 發起、投票、看狀態、重新確認都不是牌局動作：seatOwnerError 順手記的時間一律還原，不會讓卡住的人重新起算。
// 解散時照原本的中途解散流程（打過至少一局就記下當下總分，再關房），但改成原子解散：lib/mahjong/leave/dissolve.ts。
import { loadRoom, saveGameStateIfUnchanged, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { activeBefore, evaluateLeave, IDLE_VOTE_MS, restoreActive, type LeaveEval } from "@/lib/mahjong/leave/rules";
import { decideLeave, idleSeatsOf } from "@/lib/mahjong/leave/dissolve";

const view = (e: LeaveEval) => ({
  needed: e.needed, approvedCount: e.approvedCount, deniedCount: e.deniedCount,
  idleSeats: idleSeatsOf(e),
  idleAfterSec: IDLE_VOTE_MS / 1000,
  activityUnknown: e.activityUnknown, // 這房還沒有牌局動作紀錄（上線前的舊房）：判斷不了誰卡住，一律要全員同意
});

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const roomId = q.get("roomId"), playerId = q.get("playerId");
  if (!roomId || !playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  const room = await loadRoom(roomId);
  if (!room || !room.game_state) return Response.json({ error: "找不到遊戲" }, { status: 404 });
  const before = activeBefore(room.game_state as MahjongGameState, playerId);
  const notOwner = await seatOwnerError(request, room.game_state, playerId);
  if (notOwner) return notOwner;
  const s = room.game_state as MahjongGameState;
  restoreActive(s, playerId, before); // 看狀態不是牌局動作（這份也不會存檔）
  const e = evaluateLeave(s, Date.now());
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
  const before = activeBefore(room.game_state as MahjongGameState, playerId);
  // 確認是這個座位的本人（一律要登入）
  const notOwner = await seatOwnerError(request, room.game_state, playerId);
  if (notOwner) return notOwner;

  const state = room.game_state as MahjongGameState;
  restoreActive(state, playerId, before); // 投票、重新確認不是牌局動作：不更新最後牌局動作時間
  if (!state.leaveRequest) {
    return Response.json({ error: "沒有離開請求" }, { status: 400 });
  }
  const voter = state.players.find((p) => p.id === playerId);
  if (!voter) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }

  const lr = { ...state.leaveRequest };
  if (check) {
    // 重新確認只給發起者
    if (lr.requesterId !== playerId) return Response.json({ error: "只有發起者可以重新確認" }, { status: 403 });
  } else {
    if (lr.requesterId === playerId) {
      return Response.json({ error: "不能投給自己" }, { status: 403 });
    }
    if (approve) {
      if (!lr.approvedBy.includes(playerId)) lr.approvedBy = [...lr.approvedBy, playerId];
    } else {
      lr.deniedBy = [...lr.deniedBy, playerId]; // 有投票權的人不同意就取消（卡住的人按不同意不計）
    }
  }

  const evalState: MahjongGameState = { ...state, leaveRequest: lr };
  const d = await decideLeave(roomId, room.code, state, evalState);
  if (d.kind === "gone") return Response.json({ error: "找不到遊戲" }, { status: 404 });
  if (d.kind === "closed") return Response.json({ success: true, result: "granted", ...view(d.e) });
  const e = d.e;
  const broadcastEvent = e.result; // "denied" | "vote"

  // 重新確認、結果沒變：什麼都不存、不廣播
  if (check && broadcastEvent === "vote") return Response.json({ success: true, result: "vote", ...view(e) });

  const newState: MahjongGameState = broadcastEvent === "denied" ? { ...state, leaveRequest: undefined } : { ...state, leaveRequest: lr };
  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, newState.status);

  await mjBroadcast(room.code, "mj_leave_vote", {
    voterId: playerId,
    voterSeat: voter.seat,
    approve: check ? null : approve,
    approvedCount: e.approvedCount,
    deniedCount: e.deniedCount,
    result: broadcastEvent,
    requesterSeat: lr.requesterSeat,
    requesterName: lr.requesterName,
    needed: e.needed,
    idleSeats: idleSeatsOf(e),
  }, sv);

  return Response.json({ success: true, result: broadcastEvent, ...view(e) });
}

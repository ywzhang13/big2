// 解散投票的共用流程（發起、投票、發起者重新確認三條路都走這裡）：
//   判斷 → 要解散時走原子解散（lib/mahjong/leave/store.ts dissolveRoom：鎖房間列＋再確認閒置的人沒聊天／互動＋寫紀錄刪房同一個交易）
//   → 被剛發生的聊天／互動擋下時，重新讀時間、把那位算進來再判斷一次（不解散）。
// 審伯 2026-11-13 必修 1、2。
import { StateConflictError } from "@/lib/mahjong/db";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { deleteRoomEffects } from "@/lib/mahjong/effects/store";
import { deleteRoomChat } from "@/lib/mahjong/chat/store";
import { deleteRoomSpectate } from "@/lib/mahjong/spectate/store";
import { buildMahjongRecord } from "@/lib/records/build";
import { socialActivity } from "@/lib/mahjong/leave/activity";
import { evaluateLeave, IDLE_VOTE_MS, type LeaveEval } from "./rules";
import { dissolveRoom } from "@/lib/mahjong/leave/store";

export type Decision =
  | { kind: "closed"; e: LeaveEval }   // 已經解散、關房（紀錄已寫）
  | { kind: "gone" }                   // 房間已經不在
  | { kind: "keep"; e: LeaveEval };    // 不解散（投票中或被取消）：呼叫端照原本存檔、廣播

/**
 * evalState：這次動作套用後的牌局狀態（含 leaveRequest）；base：讀出來的狀態（版本號用它）。
 * 牌局版本變了丟 StateConflictError，由 retryOnConflict 重讀重做。
 */
export async function decideLeave(roomId: string, roomCode: string, base: MahjongGameState, evalState: MahjongGameState): Promise<Decision> {
  const now = Date.now();
  const e = evaluateLeave(evalState, now, await socialActivity(roomId, base))!;
  if (e.result !== "granted") return { kind: "keep", e };

  const closing: MahjongGameState = { ...evalState, leaveRequest: undefined, status: "finished" };
  const rec = buildMahjongRecord(roomId, roomCode, closing, "dissolved");
  const idleUsers = e.idle.map((x) => base.players.find((p) => p.id === x.playerId)?.userId).filter((u): u is string => !!u);
  const r = await dissolveRoom(roomId, rec, base.stateVersion, idleUsers, now - IDLE_VOTE_MS);
  if (r === "changed") throw new StateConflictError();
  if (r === "not_found" || r === "already_closed") return { kind: "gone" };
  if (r === "activity") {
    // 被當成閒置的人剛剛聊天或互動：重新讀時間，他會被算進來；讀不到就退回全員同意。不管怎樣這次都不解散
    const e2 = evaluateLeave(evalState, Date.now(), await socialActivity(roomId, base))!;
    return { kind: "keep", e: { ...e2, result: e2.result === "granted" ? "vote" : e2.result } };
  }

  // closed：和 lib/records/close.ts 關房成功後一樣清掉這房的附屬資料、通知前端
  for (const [label, fn] of [["特效冷卻", deleteRoomEffects], ["語音與聊天冷卻", deleteRoomChat], ["觀戰資料", deleteRoomSpectate]] as const) {
    try { await fn(roomId); } catch (err) { console.error(`[mj-leave] 解散後刪除房 ${roomId} 的${label}失敗：`, err instanceof Error ? err.message : err); }
  }
  const lr = evalState.leaveRequest!;
  try {
    await mjBroadcastBatch(roomCode, [
      { event: "mj_leave_vote", payload: { voterId: null, voterSeat: null, approve: null, approvedCount: e.approvedCount, deniedCount: 0, result: "granted",
        requesterSeat: lr.requesterSeat, requesterName: lr.requesterName, needed: e.needed, idleSeats: idleSeatsOf(e) } },
      { event: "mj_room_closed", payload: { endReason: "dissolved", recorded: !!rec,
        players: (rec?.players ?? []).map((p) => ({ seat: p.seat, playerName: p.playerName, totalScore: p.totalScore })) } },
    ]);
  } catch { /* 廣播失敗不影響：房間已關，重新整理會拿到「這場已結束」 */ }
  return { kind: "closed", e };
}

export const idleSeatsOf = (e: LeaveEval) => e.idle.map((x) => ({ seat: x.seat, name: x.name, idleSec: Math.floor(x.idleMs / 1000) }));

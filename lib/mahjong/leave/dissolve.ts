// 解散投票的共用流程（發起、投票、發起者重新確認三條路都走這裡）：判斷 → 要解散時原子關房。
// 原子性：卡住只看牌局動作，而每個牌局動作都會讓牌局版本 +1。關房用既有的 close_room_with_record（lib/records/store.ts closeRoom），
// 它在同一個交易裡鎖住房間那一列、比對版本、寫中途解散紀錄、刪房：
//   ・判斷之後卡住的人剛好出牌（版本變了）→ changed，什麼都沒改 → 丟 StateConflictError，由 retryOnConflict 重讀重判（他已經恢復投票權）
//   ・先關房 → 之後的出牌找不到房間
import { StateConflictError } from "@/lib/mahjong/db";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { deleteRoomEffects } from "@/lib/mahjong/effects/store";
import { deleteRoomChat } from "@/lib/mahjong/chat/store";
import { deleteRoomSpectate } from "@/lib/mahjong/spectate/store";
import { closeRoom } from "@/lib/records/store";
import { buildMahjongRecord } from "@/lib/records/build";
import { evaluateLeave, type LeaveEval } from "./rules";

export type Decision =
  | { kind: "closed"; e: LeaveEval }   // 已經解散、關房（紀錄已寫）
  | { kind: "gone" }                   // 房間已經不在
  | { kind: "keep"; e: LeaveEval };    // 不解散（投票中或被取消）：呼叫端照原本存檔、廣播

/** evalState：這次動作套用後的牌局狀態（含 leaveRequest）；base：讀出來的狀態（版本號用它） */
export async function decideLeave(roomId: string, roomCode: string, base: MahjongGameState, evalState: MahjongGameState): Promise<Decision> {
  const e = evaluateLeave(evalState, Date.now())!;
  if (e.result !== "granted") return { kind: "keep", e };

  const closing: MahjongGameState = { ...evalState, leaveRequest: undefined, status: "finished" };
  const rec = buildMahjongRecord(roomId, roomCode, closing, "dissolved");
  const r = await closeRoom("mahjong", roomId, rec, { stateVersion: base.stateVersion });
  if (r === "changed") throw new StateConflictError();
  if (r !== "closed") return { kind: "gone" };

  // 和 lib/records/close.ts 關房成功後一樣清掉這房的附屬資料、通知前端（解散結果先、房間關閉後，前端照原本順序處理）
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

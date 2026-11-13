// 測試用：lib/mahjong/leave/store.ts 的記憶體版本。
//   activity[房間][帳號] = 最後一次聊天或丟互動的時間（毫秒）
//   dissolveRoom：模擬 mj_leave_dissolve 的判斷順序（真的 SQL 在 tests/_sql-idle-vote.ts 測）：
//     房間不在 → not_found；被當成閒置的人在 cutoff 之後有活動 → activity（什麼都不改）；否則走記憶體版 close_room_with_record
//   hooks.beforeDissolve：在「判斷完、解散交易開始前」插進來的事（模擬這段時間有人剛好聊天）
import { closeRoom } from "./stub-records-store";
import type { MatchRecordInput } from "../../lib/records/types";

export const activity: Record<string, Record<string, number>> = {};
export const fail = { on: false };
export const hooks: { beforeDissolve?: (roomId: string) => void } = {};
export const dissolveCalls: { roomId: string; idleUserIds: string[]; result: string }[] = [];

export async function socialActivityByUser(roomId: string): Promise<Record<string, number>> {
  if (fail.on) throw new Error("模擬資料庫錯誤");
  return { ...(activity[roomId] ?? {}) };
}

export async function dissolveRoom(roomId: string, rec: MatchRecordInput | null, expectedVersion: number | undefined, idleUserIds: string[], cutoffMs: number) {
  hooks.beforeDissolve?.(roomId);
  const act = activity[roomId] ?? {};
  let result: string;
  if (idleUserIds.some((u) => (act[u] ?? 0) >= cutoffMs)) result = "activity";
  else result = await closeRoom("mahjong", roomId, rec, { stateVersion: expectedVersion });
  dissolveCalls.push({ roomId, idleUserIds, result });
  return result as "closed" | "activity" | "changed" | "not_found" | "already_closed";
}

// 測試用：lib/big2/startConfirmStore.ts 的記憶體版本。房間、座位放在 stub-records-store 的 big2Rooms，
// 房主、準備名單、確認狀態放在 stub-big2-leave-store 的 extra（退出、發牌、讀狀態都看同一份）。
import { big2Rooms } from "./stub-records-store";
import { applyPatch, extra } from "./stub-big2-leave-store";
/** 入座憑證的雜湊（正式版是只有伺服器能讀寫的 big2_seat_keys），鍵＝房間 id + ":" + 玩家 id */
export const seatKeyHashes: Record<string, string> = {};
/** 測試用（審伯 R1～R3 交錯）：條件更新判斷之前插進來的事（模擬另一台伺服器剛好寫入、時間經過） */
export const confirmHooks: { beforeUpdate?: (roomId: string, patch: Record<string, unknown>) => Promise<void> | void } = {};
const wait = () => new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 3))); // 網路延遲：讓同時送出的請求交錯
export async function loadConfirmRoom(roomId: string) {
  await wait();
  const b = big2Rooms[roomId];
  if (!b) return null;
  const x = extra[roomId];
  return { id: b.room.id, code: b.room.code, status: b.room.status, host_id: x?.host_id ?? null, row_version: b.room.row_version ?? 0,
    start_confirm: x?.start_confirm ?? null, last_start_confirm: x?.last_start_confirm ?? null };
}
export async function saveSeatKeyHash(roomId: string, playerId: string, keyHash: string) {
  await wait();
  seatKeyHashes[`${roomId}:${playerId}`] = keyHash;
}
export async function loadSeatKeyHash(roomId: string, playerId: string) {
  await wait();
  return big2Rooms[roomId]?.players.some((p) => p.player_id === playerId) ? seatKeyHashes[`${roomId}:${playerId}`] ?? null : null;
}
export async function loadSeatIds(roomId: string) {
  await wait();
  return [...(big2Rooms[roomId]?.players ?? [])].sort((a, b) => a.seat - b.seat).map((p) => p.player_id);
}
export async function updateRoomIf(roomId: string, rowVersion: number, statuses: string[], patch: Record<string, unknown>) {
  await wait();
  await confirmHooks.beforeUpdate?.(roomId, patch);
  const b = big2Rooms[roomId]; // ↓ 以下沒有 await：等同資料庫的條件更新
  if (!b || (b.room.row_version ?? 0) !== rowVersion || !statuses.includes(b.room.status)) return null;
  applyPatch(roomId, patch);
  b.room.row_version = rowVersion + 1;
  return b.room.row_version; // 和正式版一樣回寫入後的 row_version
}

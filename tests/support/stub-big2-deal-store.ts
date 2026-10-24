// 測試用：lib/big2/dealStore.ts 的記憶體版本（大老二發牌）。房間和座位放在 stub-records-store 的 big2Rooms，
// 和 stub-big2-leave-store 共用（退出、發牌看同一份資料）。座位的 row id 就用 player_id。
import { big2Rooms } from "./stub-records-store";
import type { Card } from "../../lib/constants";
/** 讀完座位之後、改房間狀態之前要插進來的事（模擬這段時間有人退出） */
export const dealHooks: { beforeStart?: (roomId: string) => Promise<void> } = {};
export const startUpdates: Record<string, Record<string, unknown>> = {};
const wait = () => new Promise((r) => setTimeout(r, 2));
export async function loadRoomForDeal(roomId: string) {
  await wait();
  const b = big2Rooms[roomId];
  return b ? { row_version: b.room.row_version ?? 0, status: b.room.status } : null;
}
export async function loadSeatedPlayers(roomId: string) {
  await wait();
  return [...(big2Rooms[roomId]?.players ?? [])].sort((a, b) => a.seat - b.seat).map((p) => ({ id: p.player_id, player_id: p.player_id, name: p.name, seat: p.seat }));
}
export async function saveHand(playerRowId: string, hand: Card[]) {
  await wait();
  for (const b of Object.values(big2Rooms)) { const p = b.players.find((x) => x.player_id === playerRowId); if (p) p.hand = hand; }
}
export async function startRoomIfUnchanged(roomId: string, rowVersion: number, statuses: string[], update: Record<string, unknown>) {
  await dealHooks.beforeStart?.(roomId);
  await wait();
  const b = big2Rooms[roomId];
  if (!b || (b.room.row_version ?? 0) !== rowVersion || !statuses.includes(b.room.status)) return false;
  b.room.status = String(update.status);
  if (update.scores !== undefined) b.room.scores = update.scores as Record<string, number>;
  b.room.row_version = rowVersion + 1;
  startUpdates[roomId] = update;
  return true;
}

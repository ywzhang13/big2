// 測試用：lib/big2/leaveStore.ts 的記憶體版本。房間和座位放在 stub-records-store 的 big2Rooms
// （關房 closeRoom 也看同一份），另外記 host_id、ready_players；座位陣列順序＝加入順序（created_at 先後）。
import { big2Rooms } from "./stub-records-store";
export const extra: Record<string, { host_id: string | null; ready_players: string[] }> = {};
const wait = () => new Promise((r) => setTimeout(r, 2));
export async function loadRoom(roomId: string) {
  await wait();
  const b = big2Rooms[roomId];
  if (!b) return null;
  return { id: b.room.id, code: b.room.code, status: b.room.status, host_id: extra[roomId]?.host_id ?? null, scores: b.room.scores, row_version: b.room.row_version ?? 0 };
}
export async function loadPlayers(roomId: string) {
  await wait();
  return (big2Rooms[roomId]?.players ?? []).map((p, i) => ({ player_id: p.player_id, seat: p.seat, name: p.name, created_at: String(i).padStart(6, "0") }));
}
export async function claimRoom(roomId: string, rowVersion: number, patch: Record<string, unknown>) {
  await wait();
  const b = big2Rooms[roomId];
  if (!b || (b.room.row_version ?? 0) !== rowVersion || !["waiting", "ready_check"].includes(b.room.status)) return null;
  const x = (extra[roomId] ??= { host_id: null, ready_players: [] });
  if (typeof patch.status === "string") b.room.status = patch.status;
  if (Array.isArray(patch.ready_players)) x.ready_players = patch.ready_players as string[];
  if (typeof patch.host_id === "string") x.host_id = patch.host_id;
  b.room.row_version = rowVersion + 1; // trigger：每次更新 +1
  return b.room.row_version;
}
export async function deletePlayer(roomId: string, playerId: string) {
  await wait();
  const list = big2Rooms[roomId]?.players ?? [];
  const i = list.findIndex((p) => p.player_id === playerId);
  if (i < 0) return 0;
  list.splice(i, 1);
  return 1;
}

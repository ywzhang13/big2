// 測試用：lib/big2/roomStore.ts 的記憶體版本（大老二加入房間、讀牌桌狀態）。房間和座位放在 stub-records-store 的 big2Rooms，
// 和退出、發牌的替身共用同一份資料；房主、準備名單看 stub-big2-leave-store 的 extra。
// 牌局欄位（current_turn 等）測試直接寫在 big2Rooms[id].room 上，沒寫就是 null。
import { big2Rooms } from "./stub-records-store";
import { extra } from "./stub-big2-leave-store";
const wait = () => new Promise((r) => setTimeout(r, 2));
const byCode = (code: string) => Object.values(big2Rooms).find((b) => b.room.code === code);
export async function findRoomByCode(code: string) {
  await wait();
  const b = byCode(code);
  return b ? { id: b.room.id, code: b.room.code, status: b.room.status } : null;
}
export async function loadSeats(roomId: string) {
  await wait();
  return [...(big2Rooms[roomId]?.players ?? [])].sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, player_id: p.player_id }));
}
export async function insertSeat(row: { room_id: string; player_id: string; name: string; seat: number }) {
  await wait();
  const list = big2Rooms[row.room_id]?.players;
  if (!list) return { code: "23503" };
  if (list.some((p) => p.seat === row.seat || p.player_id === row.player_id)) return { code: "23505" };
  list.push({ player_id: row.player_id, name: row.name, seat: row.seat, hand: [] });
  return null;
}
export async function loadRoomState(roomId: string) {
  await wait();
  const b = big2Rooms[roomId];
  if (!b) return null;
  const r = b.room as typeof b.room & Record<string, unknown>;
  return {
    id: r.id, code: r.code, status: r.status, host_id: extra[roomId]?.host_id ?? null,
    current_turn: r.current_turn ?? null, last_play: r.last_play ?? null, pass_count: r.pass_count ?? 0, round_starter: r.round_starter ?? null,
    scores: r.scores, ready_players: extra[roomId]?.ready_players ?? [],
  };
}
export async function loadRoomPlayers(roomId: string) {
  await wait();
  const b = big2Rooms[roomId];
  if (!b) return null;
  return [...b.players].sort((x, y) => x.seat - y.seat).map((p) => ({
    player_id: p.player_id, name: p.name, seat: p.seat, card_count: p.hand.length, is_finished: false, finish_order: null, hand: p.hand,
  }));
}

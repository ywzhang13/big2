// 記憶體版 db：模擬 Postgres 的樂觀鎖。讀、寫都會 await 一段時間，讓同時送出的請求真的交錯。
import type { MahjongGameState } from "../../lib/mahjong/gameState";
export const rooms: Record<string, { id: string; code: string; game_state: MahjongGameState; status?: string; host_id?: string | null; updated_at?: string }> = {};
export const stats = { conflicts: 0, writes: 0 };
/** 存檔成功後的掛鉤（真的 db.ts 存檔後會呼叫 recordZimoWins）；flow-donate 設成同一個函式，其他測試不設 */
export const hooks: { onSaved?: (id: string, s: MahjongGameState) => Promise<void> } = {};
export const opts = {
  unsafe: false, // true：模擬修之前「讀完整筆蓋回去」
  delayMs: 5,
  // true（預設）：沒綁帳號的座位自動綁「u:<玩家id>」——給不專門測登入的流程測試用（搭配 stub-auth 的 asSeat）；
  // flow-auth 關掉，才測得到「上線前沒綁帳號的舊房」
  autoBind: true,
};
const wait = () => new Promise((r) => setTimeout(r, opts.delayMs));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export class StateConflictError extends Error {}
export async function loadRoom(id: string) {
  await wait();
  const r = rooms[id];
  if (!r) return null;
  const gs = clone(r.game_state);
  if (opts.autoBind) for (const p of gs?.players ?? []) p.userId ??= `u:${p.id}`;
  return { ...r, game_state: gs };
}
export async function saveGameState(id: string, s: MahjongGameState, status?: string) {
  await wait();
  s.stateVersion = (s.stateVersion ?? 0) + 1;
  rooms[id].game_state = clone(s); stats.writes++;
  if (status) rooms[id].status = status;
  await hooks.onSaved?.(id, s);
}
export async function saveGameStateIfUnchanged(id: string, base: number | undefined, s: MahjongGameState, status?: string) {
  await wait();
  if (!opts.unsafe && rooms[id].game_state.stateVersion !== base) { stats.conflicts++; throw new StateConflictError(); }
  s.stateVersion = (base ?? 0) + 1;
  rooms[id].game_state = clone(s); stats.writes++;
  if (status) rooms[id].status = status;
  await hooks.onSaved?.(id, s);
}
export function findSeatByPlayerId(s: MahjongGameState, pid: string) { const p = s.players.find((x) => x.id === pid); return p ? p.seat : -1; }
export async function retryOnConflict(handler: (fresh: boolean) => Promise<Response>): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await handler(attempt > 0); }
    catch (err) {
      if (err instanceof StateConflictError) continue;
      return Response.json({ error: err instanceof Error ? err.message : "伺服器錯誤" }, { status: 500 });
    }
  }
  return Response.json({ error: "同時有太多動作，請再試一次" }, { status: 409 });
}
/** 房間裡的座位（mj_players）；沒設定的房間 loadPlayers 照舊回 p0～p3、沒有綁登入 */
export const seats: Record<string, { player_id: string; name: string; seat: number; user_id: string | null }[]> = {};
export async function loadPlayers(_id: string) {
  if (seats[_id]) return seats[_id].map((p) => ({ id: "row" + p.seat, room_id: _id, ...p }));
  return [0, 1, 2, 3].map((seat) => ({ id: "row" + seat, room_id: _id, player_id: "p" + seat, name: "P" + seat, seat, user_id: opts.autoBind ? `u:p${seat}` : null }));
}
export async function loadRoomByCode(code: string) {
  await wait();
  const r = Object.values(rooms).find((x) => x.code === code);
  return r ? { ...r, status: r.status ?? "waiting", host_id: r.host_id ?? null, game_state: clone(r.game_state) } : null;
}
let nextRoom = 1;
export async function insertRoom(row: { code: string; status: string; host_id: string; game_state: Record<string, unknown> | null }) {
  await wait();
  if (Object.values(rooms).some((x) => x.code === row.code)) return "duplicate" as const;
  const id = "room-" + nextRoom++;
  rooms[id] = { id, code: row.code, status: row.status, host_id: row.host_id, game_state: row.game_state as unknown as MahjongGameState };
  return { id };
}
export async function loadSeats(roomId: string) {
  await wait();
  return (seats[roomId] ?? []).map(({ seat, player_id, user_id }) => ({ seat, player_id, user_id })).sort((a, b) => a.seat - b.seat);
}
export async function loadSeatsByUser(userId: string) {
  await wait();
  const out: { code: string; room_id: string; status: string; seat: number; updated_at: string }[] = [];
  for (const [roomId, list] of Object.entries(seats)) {
    const p = list.find((x) => x.user_id === userId);
    const r = rooms[roomId];
    const gameSeat = r?.game_state?.players?.find((x) => x.id === p?.player_id)?.seat; // 開局後以牌局座位為準
    if (p && r) out.push({ code: r.code, room_id: roomId, status: r.status ?? "waiting", seat: gameSeat ?? p.seat, updated_at: r.updated_at ?? "" });
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export async function insertPlayer(row: { room_id: string; player_id: string; name: string; seat: number; user_id: string | null }) {
  await wait();
  const list = (seats[row.room_id] ??= []);
  if (list.some((p) => p.seat === row.seat || p.player_id === row.player_id)) return "duplicate" as const;
  list.push({ player_id: row.player_id, name: row.name, seat: row.seat, user_id: row.user_id });
  return "ok" as const;
}
// 純函式（不連資料庫），沿用真的版本：state 路由、開局廣播用（公開資訊不能含手牌）
export { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";

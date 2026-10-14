// 記憶體版 db：模擬 Postgres 的樂觀鎖。讀、寫都會 await 一段時間，讓同時送出的請求真的交錯。
import type { MahjongGameState } from "../../lib/mahjong/gameState";
export const rooms: Record<string, { id: string; code: string; game_state: MahjongGameState; status?: string; host_id?: string }> = {};
export const stats = { conflicts: 0, writes: 0 };
export const opts = { unsafe: false, delayMs: 5 }; // unsafe=true：模擬修之前「讀完整筆蓋回去」
const wait = () => new Promise((r) => setTimeout(r, opts.delayMs));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export class StateConflictError extends Error {}
export async function loadRoom(id: string) {
  await wait();
  const r = rooms[id];
  return r ? { ...r, game_state: clone(r.game_state) } : null;
}
export async function saveGameState(id: string, s: MahjongGameState, status?: string) {
  await wait();
  s.stateVersion = (s.stateVersion ?? 0) + 1;
  rooms[id].game_state = clone(s); stats.writes++;
  if (status) rooms[id].status = status;
}
export async function saveGameStateIfUnchanged(id: string, base: number | undefined, s: MahjongGameState, status?: string) {
  await wait();
  if (!opts.unsafe && rooms[id].game_state.stateVersion !== base) { stats.conflicts++; throw new StateConflictError(); }
  s.stateVersion = (base ?? 0) + 1;
  rooms[id].game_state = clone(s); stats.writes++;
  if (status) rooms[id].status = status;
}
export function findSeatByPlayerId(s: MahjongGameState, pid: string) { const p = s.players.find((x) => x.id === pid); return p ? p.seat : -1; }
export function toPublicGameState(s: MahjongGameState) { return s; }
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
export async function loadPlayers(_id: string) {
  return [0, 1, 2, 3].map((seat) => ({ id: "row" + seat, room_id: _id, player_id: "p" + seat, name: "P" + seat, seat }));
}

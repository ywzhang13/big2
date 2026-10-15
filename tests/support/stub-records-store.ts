// 測試用：lib/records/store.ts 的記憶體版本（不連資料庫）。
// closeRoom 模擬 Postgres function close_room_with_record：先等一下（網路），再在不中斷的區段裡
// 「鎖房 → 檢查有沒有新動作 → 寫紀錄 → 刪房」一次做完；中途失敗時什麼都不改。
import { rooms as mjRooms, seats as mjSeats } from "./stub-db";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import type { Big2PlayerRow, Big2RoomRow } from "../../lib/records/build";
import type { CloseExpect, CloseResult } from "../../lib/records/store";
import type { GameKind, MatchRecordInput, MatchRecordSummary } from "../../lib/records/types";

export const records: (MatchRecordInput & { endedAt: string })[] = [];
export const deleted: { game: GameKind; roomId: string }[] = [];
export const opts: {
  failClose: boolean; // 模擬交易中途失敗（例如寫玩家時出錯）→ 整筆取消
  closeCalls: number;
  /** 選中之後、真的關房之前插進來的事（模擬這段時間有人動了房間） */
  beforeClose?: (game: GameKind, roomId: string) => void;
} = { failClose: false, closeCalls: 0 };
/** 麻將房的最後更新時間（真的資料庫由 trigger 維護；這裡由測試指定） */
export const mjUpdatedAt: Record<string, string> = {};
/** 麻將房的建房時間（上線時關舊房用；由測試指定） */
export const mjCreatedAt: Record<string, string> = {};
/** 麻將房的異動次數（真的資料庫由 trigger 每次更新 +1；沒設定就當 0） */
export const mjRowVersion: Record<string, number> = {};
export const big2Rooms: Record<string, { room: Big2RoomRow & { updated_at: string; row_version?: number }; players: Big2PlayerRow[] }> = {};
/** 模擬「房間有新動作」：資料庫 trigger 會同時更新 updated_at 和 row_version */
export function touch(game: GameKind, roomId: string, nowIso: string) {
  if (game === "mahjong") { mjUpdatedAt[roomId] = nowIso; mjRowVersion[roomId] = (mjRowVersion[roomId] ?? 0) + 1; }
  else { big2Rooms[roomId].room.updated_at = nowIso; big2Rooms[roomId].room.row_version = (big2Rooms[roomId].room.row_version ?? 0) + 1; }
}

export function reset() {
  records.length = 0; deleted.length = 0; opts.failClose = false; opts.closeCalls = 0; opts.beforeClose = undefined;
  for (const k of Object.keys(mjUpdatedAt)) delete mjUpdatedAt[k];
  for (const k of Object.keys(mjRowVersion)) delete mjRowVersion[k];
  for (const k of Object.keys(mjCreatedAt)) delete mjCreatedAt[k];
  for (const k of Object.keys(big2Rooms)) delete big2Rooms[k];
}

export async function closeRoom(game: GameKind, roomId: string, rec: MatchRecordInput | null, expect: CloseExpect): Promise<CloseResult> {
  opts.closeCalls++;
  await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 4))); // 網路延遲：讓同時送出的請求交錯
  opts.beforeClose?.(game, roomId);
  // ↓ 以下沒有 await：等同資料庫裡鎖住這一列後的單一交易
  const exists = game === "mahjong" ? !!mjRooms[roomId] : !!big2Rooms[roomId];
  if (!exists) return records.some((r) => r.game === game && r.roomId === roomId) ? "already_closed" : "not_found";
  const rowVersion = game === "mahjong" ? (mjRowVersion[roomId] ?? 0) : (big2Rooms[roomId].room.row_version ?? 0);
  const version = game === "mahjong" ? (mjRooms[roomId].game_state as MahjongGameState | null)?.stateVersion : undefined;
  if ((expect.rowVersion !== undefined && expect.rowVersion !== rowVersion) || (expect.stateVersion !== undefined && expect.stateVersion !== version)) {
    return "changed";
  }
  if (opts.failClose) throw new Error("模擬交易中途失敗");
  if (rec && !records.some((r) => r.game === game && r.roomId === roomId)) {
    records.push({ ...JSON.parse(JSON.stringify(rec)), endedAt: new Date().toISOString() });
  }
  deleted.push({ game, roomId });
  if (game === "mahjong") delete mjRooms[roomId];
  else delete big2Rooms[roomId];
  return "closed";
}

const summary = (r: (typeof records)[number]): MatchRecordSummary => ({
  game: r.game, roomCode: r.roomCode, endReason: r.endReason, endedAt: r.endedAt,
  players: r.players.map((p) => ({ seat: p.seat, playerName: p.playerName, totalScore: p.totalScore })),
});
export async function findRecordByRoomId(game: GameKind, roomId: string) {
  const r = records.find((x) => x.game === game && x.roomId === roomId);
  return r ? summary(r) : null;
}
export async function findRecentRecordByCode(game: GameKind, code: string, sinceIso: string) {
  const r = [...records].reverse().find((x) => x.game === game && x.roomCode === code && x.endedAt >= sinceIso);
  return r ? summary(r) : null;
}
const idle = (status: string, updatedAt: string, w: string, a: string) => (status === "waiting" ? updatedAt < w : updatedAt < a);
export async function listIdleMahjongRooms(w: string, a: string, limit: number) {
  return Object.values(mjRooms)
    .filter((r) => mjUpdatedAt[r.id] && idle(r.status ?? "waiting", mjUpdatedAt[r.id], w, a))
    .slice(0, limit)
    .map((r) => ({ id: r.id, code: r.code, status: r.status ?? "waiting", row_version: mjRowVersion[r.id] ?? 0, game_state: JSON.parse(JSON.stringify(r.game_state)) as MahjongGameState | null }));
}
export async function listIdleBig2Rooms(w: string, a: string, limit: number) {
  return Object.values(big2Rooms)
    .filter((x) => idle(x.room.status, x.room.updated_at, w, a))
    .slice(0, limit)
    .map((x) => JSON.parse(JSON.stringify({ room: { ...x.room, row_version: x.room.row_version ?? 0 }, players: x.players })));
}

// 歷史紀錄：模擬 listMyMahjongMatches／summarizeMyMahjong（只回這個使用者打過的麻將場次，新到舊、keyset 分頁）
type Rec = (typeof records)[number] & { id?: string };
const recId = (r: Rec, i: number) => (r.id ??= `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
export async function listMyMahjongMatches(userId: string, limit: number, cursor: { endedAt: string; id: string } | null) {
  return (records as Rec[])
    .map((r, i) => ({ r, id: recId(r, i) }))
    .filter(({ r }) => r.game === "mahjong" && r.players.some((p) => p.userId === userId))
    .sort((a, b) => (a.r.endedAt === b.r.endedAt ? (a.id < b.id ? 1 : -1) : a.r.endedAt < b.r.endedAt ? 1 : -1))
    .filter(({ r, id }) => !cursor || r.endedAt < cursor.endedAt || (r.endedAt === cursor.endedAt && id < cursor.id))
    .slice(0, limit)
    .map(({ r, id }) => {
      const players = [...r.players].sort((a, b) => a.seat - b.seat)
        .map((p) => ({ seat: p.seat, playerName: p.playerName, totalScore: p.totalScore, isMe: p.userId === userId }));
      return {
        id, roomCode: r.roomCode, endedAt: r.endedAt, endReason: r.endReason, totalRounds: r.totalRounds, basePoints: r.basePoints,
        fanPoints: r.fanPoints, handsPlayed: r.handsPlayed, myScore: players.find((p) => p.isMe)?.totalScore ?? 0, players,
      };
    });
}
export async function summarizeMyMahjong(userId: string) {
  const mine = records.filter((r) => r.game === "mahjong").flatMap((r) => r.players.filter((p) => p.userId === userId));
  return { matches: mine.length, totalScore: mine.reduce((s, p) => s + p.totalScore, 0) };
}

// 上線時關舊房：beforeIso 之前建的麻將房（含座位），建房時間舊到新
export async function listMahjongRoomsCreatedBefore(beforeIso: string) {
  return Object.values(mjRooms)
    .filter((r) => mjCreatedAt[r.id] && mjCreatedAt[r.id] < beforeIso)
    .sort((a, b) => (mjCreatedAt[a.id] < mjCreatedAt[b.id] ? -1 : 1))
    .map((r) => ({
      id: r.id, code: r.code, status: r.status ?? "waiting", created_at: mjCreatedAt[r.id], updated_at: mjUpdatedAt[r.id] ?? mjCreatedAt[r.id],
      row_version: mjRowVersion[r.id] ?? 0, game_state: JSON.parse(JSON.stringify(r.game_state ?? null)) as MahjongGameState | null,
      mj_players: (mjSeats[r.id] ?? []).map(({ seat, name, user_id }) => ({ seat, name, user_id })),
    }));
}

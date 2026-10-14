// 對局紀錄與清房的資料庫存取（只在伺服器用 service role 金鑰）。
// 寫紀錄＋刪房一律走 close_room_with_record（同一個交易），不分開呼叫。
// 測試時整個檔案會被換成 tests/support/stub-records-store.ts 的記憶體版本。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { invalidateGameState } from "@/lib/mahjong/cache";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import type { Big2PlayerRow, Big2RoomRow } from "./build";
import type { GameKind, MatchRecordInput, MatchRecordSummary } from "./types";


export type CloseResult = "closed" | "already_closed" | "changed" | "not_found";

/** 刪除當下要再確認的值（選中／存檔時看到的）；不一樣代表房間有新動作，不刪也不記 */
export interface CloseExpect {
  rowVersion?: number; // 房間那一列的異動次數（trigger 每次更新 +1）；清理選中時讀到的值
  stateVersion?: number; // 麻將牌局狀態的版本號（打完／解散時剛存檔的版本）
}

/**
 * 在同一個資料庫交易裡「寫紀錄（rec 不是 null 時）＋刪房」：要嘛全部成功、要嘛全部不做。
 * 由 Postgres function close_room_with_record 完成（會先鎖住房間那一列）。
 * 網路或資料庫錯誤時丟錯誤（房間和紀錄都沒變），呼叫端不刪房、之後再試。
 */
export async function closeRoom(
  game: GameKind,
  roomId: string,
  rec: MatchRecordInput | null,
  expect: CloseExpect
): Promise<CloseResult> {
  const { data, error } = await getSupabaseAdmin().rpc("close_room_with_record", {
    p_game: game,
    p_room_id: roomId,
    p_record: rec
      ? {
          room_code: rec.roomCode,
          started_at: rec.startedAt,
          end_reason: rec.endReason,
          total_rounds: rec.totalRounds,
          base_points: rec.basePoints,
          fan_points: rec.fanPoints,
          settings: rec.settings,
          hands_played: rec.handsPlayed,
          players: rec.players.map((p) => ({
            seat: p.seat,
            player_name: p.playerName,
            player_id: p.playerId,
            total_score: p.totalScore,
          })),
        }
      : null,
    p_expected_row_version: expect.rowVersion ?? null,
    p_expected_version: expect.stateVersion ?? null,
  });
  if (error) throw new Error(`close_room_with_record 失敗：${error.message}`);
  if (data === "closed" && game === "mahjong") await invalidateGameState(roomId);
  return data as CloseResult;
}

type RecordRow = {
  game: GameKind;
  room_code: string;
  end_reason: MatchRecordSummary["endReason"];
  ended_at: string;
  match_record_players: { seat: number; player_name: string; total_score: number }[];
};
const SUMMARY_COLUMNS = "game, room_code, end_reason, ended_at, match_record_players(seat, player_name, total_score)";
function toSummary(r: RecordRow): MatchRecordSummary {
  return {
    game: r.game,
    roomCode: r.room_code,
    endReason: r.end_reason,
    endedAt: r.ended_at,
    players: [...r.match_record_players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, playerName: p.player_name, totalScore: p.total_score })),
  };
}

/** 用房間 id 找這場的紀錄（房間已刪、重新整理時用） */
export async function findRecordByRoomId(game: GameKind, roomId: string): Promise<MatchRecordSummary | null> {
  const { data } = await getSupabaseAdmin()
    .from("match_records")
    .select(SUMMARY_COLUMNS)
    .eq("game", game)
    .eq("room_id", roomId)
    .maybeSingle();
  return data ? toSummary(data as unknown as RecordRow) : null;
}

/** 用房號找最近結束的紀錄（房號之後會被重用，所以只看 sinceIso 之後結束的） */
export async function findRecentRecordByCode(
  game: GameKind,
  code: string,
  sinceIso: string
): Promise<MatchRecordSummary | null> {
  const { data } = await getSupabaseAdmin()
    .from("match_records")
    .select(SUMMARY_COLUMNS)
    .eq("game", game)
    .eq("room_code", code)
    .gte("ended_at", sinceIso)
    .order("ended_at", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? toSummary(data[0] as unknown as RecordRow) : null;
}

/** 閒置太久的房間：等待中超過 waitingBefore、其他狀態超過 activeBefore 沒有更新 */
function idleFilter(waitingBefore: string, activeBefore: string): string {
  return `and(status.eq.waiting,updated_at.lt.${waitingBefore}),and(status.neq.waiting,updated_at.lt.${activeBefore})`;
}

export async function listIdleMahjongRooms(
  waitingBefore: string,
  activeBefore: string,
  limit: number
): Promise<{ id: string; code: string; status: string; row_version: number; game_state: MahjongGameState | null }[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("mj_rooms")
    .select("id, code, status, row_version, game_state")
    .or(idleFilter(waitingBefore, activeBefore))
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`查詢閒置麻將房失敗：${error.message}`);
  return data ?? [];
}

export async function listIdleBig2Rooms(
  waitingBefore: string,
  activeBefore: string,
  limit: number
): Promise<{ room: Big2RoomRow & { row_version: number }; players: Big2PlayerRow[] }[]> {
  const db = getSupabaseAdmin();
  const { data: rooms, error } = await db
    .from("big2_rooms")
    .select("id, code, status, created_at, row_version, records_enabled, scores")
    .or(idleFilter(waitingBefore, activeBefore))
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`查詢閒置大老二房失敗：${error.message}`);
  if (!rooms || rooms.length === 0) return [];
  const { data: players, error: pe } = await db
    .from("big2_players")
    .select("room_id, player_id, name, seat, hand")
    .in("room_id", rooms.map((r) => r.id));
  if (pe) throw new Error(`查詢大老二玩家失敗：${pe.message}`);
  return rooms.map((room) => ({
    room: room as Big2RoomRow & { row_version: number },
    players: (players ?? []).filter((p) => p.room_id === room.id) as Big2PlayerRow[],
  }));
}

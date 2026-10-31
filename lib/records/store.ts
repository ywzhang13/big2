// 對局紀錄與清房的資料庫存取（只在伺服器用 service role 金鑰）。
// 寫紀錄＋刪房一律走 close_room_with_record（同一個交易），不分開呼叫。
// 測試時整個檔案會被換成 tests/support/stub-records-store.ts 的記憶體版本。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { invalidateGameState } from "@/lib/mahjong/cache";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import type { Big2PlayerRow, Big2RoomRow } from "./build";
import type { GameKind, MatchRecordInput, MatchRecordSummary, MyMatch } from "./types";


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
            user_id: p.userId ?? null,
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

type MyMatchRow = {
  id: string;
  room_code: string;
  ended_at: string;
  end_reason: MyMatch["endReason"];
  total_rounds: number | null;
  base_points: number | null;
  fan_points: number | null;
  hands_played: number | null;
  players: { seat: number; player_name: string; total_score: number; user_id: string | null }[];
};

/**
 * 歷史紀錄：這個使用者打過的麻將場次，ended_at、id 由新到舊（keyset 分頁）。
 * cursor＝上一頁最後一筆的 ended_at（資料庫原字串，保留微秒）與 id。
 */
export async function listMyMahjongMatches(
  userId: string,
  limit: number,
  cursor: { endedAt: string; id: string } | null
): Promise<MyMatch[]> {
  let q = getSupabaseAdmin()
    .from("match_records")
    .select(
      "id, room_code, ended_at, end_reason, total_rounds, base_points, fan_points, hands_played, " +
        "me:match_record_players!inner(user_id), players:match_record_players(seat, player_name, total_score, user_id)"
    )
    .eq("game", "mahjong")
    .eq("me.user_id", userId);
  if (cursor) {
    q = q.or(`ended_at.lt.${cursor.endedAt},and(ended_at.eq.${cursor.endedAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await q.order("ended_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`查詢歷史紀錄失敗：${error.message}`);
  return ((data ?? []) as unknown as MyMatchRow[]).map((r) => {
    const players = [...r.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, playerName: p.player_name, totalScore: p.total_score, isMe: p.user_id === userId }));
    return {
      id: r.id,
      roomCode: r.room_code,
      endedAt: r.ended_at,
      endReason: r.end_reason,
      totalRounds: r.total_rounds,
      basePoints: r.base_points,
      fanPoints: r.fan_points,
      handsPlayed: r.hands_played,
      myScore: players.find((p) => p.isMe)?.totalScore ?? 0,
      players,
    };
  });
}

/** 歷史紀錄摘要：這個使用者打過幾場麻將、累計總輸贏 */
export async function summarizeMyMahjong(userId: string): Promise<{ matches: number; totalScore: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("match_record_players")
    .select("total_score, match_records!inner(game)")
    .eq("user_id", userId)
    .eq("match_records.game", "mahjong");
  if (error) throw new Error(`查詢歷史紀錄摘要失敗：${error.message}`);
  const rows = (data ?? []) as { total_score: number }[];
  return { matches: rows.length, totalScore: rows.reduce((sum, r) => sum + r.total_score, 0) };
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

/** 上線時關舊房用：beforeIso 之前建的麻將房（含座位綁定的帳號），建房時間舊到新 */
export interface MahjongRoomRow {
  id: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
  row_version: number;
  game_state: MahjongGameState | null;
  mj_players: { seat: number; name: string; user_id: string | null }[];
}
export async function listMahjongRoomsCreatedBefore(beforeIso: string): Promise<MahjongRoomRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("mj_rooms")
    .select("id, code, status, created_at, updated_at, row_version, game_state, mj_players(seat, name, user_id)")
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`查詢舊麻將房失敗：${error.message}`);
  return (data ?? []) as MahjongRoomRow[];
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

/** 伺服器現在時間（測試換成可控制的時鐘） */
export const nowMs = () => Date.now();

/**
 * 輸贏排行榜的原始資料：麻將對局紀錄裡有綁帳號的每一位（每場一列），只要 userId 和整場輸贏。
 * range＝場次結束時間在 [from, to) 之間；不給就是全部。打完、中途解散都算（和歷史紀錄的累計同一份資料）。
 * 分頁讀完（每頁 1000），不會被筆數上限截掉。
 */
export async function listMahjongScores(range?: { from: number; to: number }): Promise<{ userId: string; score: number }[]> {
  const out: { userId: string; score: number }[] = [];
  for (let page = 0; ; page++) {
    let q = getSupabaseAdmin()
      .from("match_record_players")
      .select("match_id, seat, user_id, total_score, match_records!inner(game, ended_at)")
      .eq("match_records.game", "mahjong")
      .not("user_id", "is", null);
    if (range) q = q.gte("match_records.ended_at", new Date(range.from).toISOString()).lt("match_records.ended_at", new Date(range.to).toISOString());
    const { data, error } = await q.order("match_id").order("seat").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`讀取輸贏紀錄失敗：${error.message}`);
    const rows = (data ?? []) as unknown as { user_id: string; total_score: number }[];
    for (const r of rows) out.push({ userId: String(r.user_id), score: Number(r.total_score) || 0 });
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * 這些帳號裡「可以上排行榜」的：帳號還在、用 LINE 登入、不是遊客。回傳目前的 LINE 名稱和頭像。
 * 遊客、已刪除的帳號、email 建的測試帳號都不在結果裡。人數少，直接列全部帳號比對。
 */
export async function lineBoardAccounts(userIds: string[]): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const want = new Set(userIds), out = new Map<string, { name: string; avatarUrl: string | null }>();
  if (want.size === 0) return out;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`讀取玩家資料失敗：${error.message}`);
    for (const u of data.users) {
      if (!want.has(u.id)) continue;
      const app = (u.app_metadata ?? {}) as Record<string, unknown>;
      const providers = [app.provider, ...(Array.isArray(app.providers) ? app.providers : [])].map(String);
      if (app.guest === true || !providers.some((p) => p.includes("line"))) continue;
      const m = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = [m.name, m.full_name, m.nickname].find((v): v is string => typeof v === "string" && !!v);
      const pic = [m.picture, m.avatar_url].find((v): v is string => typeof v === "string" && v.startsWith("https://"));
      out.set(u.id, { name: name ?? "LINE 使用者", avatarUrl: pic ?? null });
    }
    if (data.users.length < 1000) break;
  }
  return out;
}

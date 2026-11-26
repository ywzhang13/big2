// 十三支房間的資料存取（只在伺服器用 service role 金鑰；資料表見 supabase/migrations/20261116_thirteen_rooms.sql）。
// 寫法照麻將 lib/mahjong/db.ts：牌局狀態整包放 th_rooms.game_state，用 stateVersion 做樂觀鎖，同時送出不會互相覆蓋。
// 和麻將不同：沒有 Redis 快取（十三支一局只有發牌、送出、亮牌幾次寫入，直接讀資料庫）。
// 關房＋寫對局紀錄走共用的 lib/records/store.ts closeRoom("thirteen", …)，紀錄內容用這裡的 buildThirteenRecord 組。
import type { StartConfirm } from "@/lib/lobby/startConfirm";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { MatchRecordInput, EndReason, MatchRecordSummary } from "@/lib/records/types";
import type { Card } from "./cards";
import type { Arrangement } from "./arrange";
import type { RoundResult } from "./score";
import { baseScoreOf, matchStats, type HandStat } from "./flow";

/** 開房可以選的理牌時間（秒）：最少 15 秒、15 秒一階、最多 120 秒（老闆 2026-11-18；原本只有 30／45／60，舊房間照樣有效） */
export const ARRANGE_SECS = [15, 30, 45, 60, 75, 90, 105, 120] as const;
export const ARRANGE_SEC_MESSAGE = "理牌時間要是 15～120 秒，每 15 秒一階（15、30、45、60、75、90、105、120）";

/** 開房可以選的局數（老闆 2026-11-18：8、16、32 局）。只在開房時檢查；已經開的房照它原本的設定打完 */
export const TOTAL_HANDS = [8, 16, 32] as const;
export const isTotalHands = (x: unknown): x is (typeof TOTAL_HANDS)[number] => TOTAL_HANDS.includes(x as (typeof TOTAL_HANDS)[number]);
export const TOTAL_HANDS_MESSAGE = "局數只能選 8、16 或 32 局";
export type ArrangeSec = (typeof ARRANGE_SECS)[number];
export const isArrangeSec = (x: unknown): x is ArrangeSec => ARRANGE_SECS.includes(x as ArrangeSec);

/** 底分（老闆 2026-11-19）：每局分數＝淨墩數 × 底分。開房畫面的預設選項是 BASE_SCORES，更大的用自訂（10～100000 的整數）；沒帶＝DEFAULT_BASE_SCORE */
export const BASE_SCORES = [30, 50, 100, 200] as const;
export const BASE_SCORE_MIN = 10, BASE_SCORE_MAX = 100000;
export type BaseScore = number;
export const DEFAULT_BASE_SCORE: BaseScore = 100;
export const isBaseScore = (x: unknown): x is BaseScore =>
  typeof x === "number" && Number.isInteger(x) && x >= BASE_SCORE_MIN && x <= BASE_SCORE_MAX;
export const BASE_SCORE_MESSAGE = "底分要是 10～100000 的整數";

export interface ThirteenSettings {
  arrangeSec: ArrangeSec; // 理牌時間
  totalHands: number;     // 這場打幾局
  scoreRule?: "jia" | "v4" | "v5"; // 計分規則：2026-11-20 起開房記 "v5"（打槍新規則）；"v4"＝11-19～20 開的房；"jia"＝甲案時期；沒有＝更早的房（v1）。整場不變（見 flow.ts scoreRuleOf）
  baseScore?: BaseScore;  // 底分（2026-11-19 起開房必有；更早的房沒有＝1，見 flow.ts baseScoreOf）
}

export interface ThirteenPlayerState {
  id: string;
  name: string;
  seat: number;
  userId: string | null;
  avatarUrl?: string | null;        // LINE 大頭照網址（開局時查一次；遊客、沒頭像、2026-11-19 前開局的牌局是 null／沒有）
  hand: Card[];                     // 這局發到的 13 張（亮牌前只能給本人看）
  arrangement: Arrangement | null;  // 送出的三墩（已通過 validateSubmission）；還沒送出＝null
  autoArranged: boolean;            // 理牌時間到了由系統自動排（autoArrange）
}

/** 一局打完的結果（scoreRound 的回傳整包存下來，結算畫面、紀錄都從這裡讀） */
export interface ThirteenHandResult {
  handNo: number;
  result: RoundResult;
  stats?: HandStat[]; // 這局每家的明細（2026-11-18 起亮牌時記；更早的局沒有，用 handStats(result) 補算）
  scores?: number[];  // 這局四家的分數＝result.totals（墩數）× 底分（2026-11-19 起亮牌時記；更早的局沒有，用 handScores 補算）
}

export interface ThirteenGameState {
  stateVersion: number;             // 樂觀鎖：每次存檔 +1
  settings: ThirteenSettings;
  hostUserId: string | null;        // 開房的帳號：房主的座位只有這個帳號能坐、只有他能開局（審伯 2026-11-16 必修 2）
  phase: "waiting" | "arranging" | "revealed";
  handNo: number;                   // 第幾局（等人時 0）
  startedAt: string | null;         // 這場開局時間（寫紀錄用）
  arrangeDeadline: number | null;   // 這局理牌截止時間（伺服器時間，毫秒）；過了就對還沒送出的人自動排
  players: ThirteenPlayerState[];   // 開局後才有，依座位排
  rest: Card[];                     // 65 張發完剩下的 1 張：v4 的房是這一局的彩金牌（公開，見 flow.ts luckyCardOf）；舊規則房只存伺服器，不給前端
  hands: ThirteenHandResult[];      // 每局結果
  playerScores: number[];           // 多局累計（依座位）
  nextReady?: string[];             // 這局亮牌後按了「下一局」的玩家 id
  nextHandAt?: number | null;       // 亮牌後到這個時間沒人按也自動開下一局（＝settleAt＋30 秒；斷線的人不會卡住牌局）
  revealedAt?: number | null;       // 這局亮牌的時間（伺服器毫秒）
  settleAt?: number | null;         // 結算面板出現的時間（＝revealedAt＋亮牌演出長度，見 flow.ts revealDurationMs）
  leaveRequest?: { requesterId: string; approvedBy: string[]; deniedBy?: string[] } | null; // 中途解散投票（判定見 flow.ts evaluateLeave）
  startConfirm?: StartConfirm | null; // 等人階段的開局確認（房主按開始後 10 秒內四家都同意才發牌；見 lib/lobby/startConfirm.ts、lib/thirteen/startConfirm.ts）
  lastStartConfirm?: { reason: "host" | "timeout" | "seats_changed" | "suspended" | "cancelled"; missingIds: string[]; at: number; by?: string } | null; // 上一次開局確認為什麼沒開成、誰沒按（房主重新按開始、開局時清掉）
  lastActive?: Record<string, number>; // 每位玩家最後一次「牌局動作」的時間（閒置不計票用，見 flow.ts）
}

export interface ThRoom {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  host_id: string | null;
  game_state: ThirteenGameState | null;
}

export interface ThPlayer {
  id: string;
  room_id: string;
  player_id: string;
  name: string;
  seat: number;
  user_id: string | null;
}

/** 剛開好、還在等人的房間狀態 */
export function newRoomState(settings: ThirteenSettings, hostUserId: string | null = null): ThirteenGameState {
  return { stateVersion: 0, settings, hostUserId, phase: "waiting", handNo: 0, startedAt: null, arrangeDeadline: null,
    players: [], rest: [], hands: [], playerScores: [0, 0, 0, 0] };
}

/** 條件寫入失敗：讀出後已經有人先寫了，呼叫端要重新讀取再做一次 */
export class StateConflictError extends Error {
  constructor() {
    super("十三支牌局狀態已被其他動作更新");
  }
}

/** 開房：房號重複回 "duplicate"（呼叫端換一個再試）；理牌時間不在 ARRANGE_SECS 裡丟錯 */
export async function insertRoom(row: { code: string; host_id: string; host_user_id: string; settings: ThirteenSettings }): Promise<{ id: string } | "duplicate"> {
  if (!isArrangeSec(row.settings.arrangeSec)) throw new Error(ARRANGE_SEC_MESSAGE);
  const { data, error } = await getSupabaseAdmin()
    .from("th_rooms")
    .insert({ code: row.code, status: "waiting", host_id: row.host_id, game_state: newRoomState(row.settings, row.host_user_id) })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`建立十三支房間失敗：${error.message}`);
  }
  return { id: data.id };
}

export async function loadRoom(roomId: string): Promise<ThRoom | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("th_rooms")
    .select("id, code, status, host_id, game_state")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(`讀取十三支房間失敗：${error.message}`);
  return (data as ThRoom | null) ?? null;
}

export async function loadRoomByCode(code: string): Promise<ThRoom | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("th_rooms")
    .select("id, code, status, host_id, game_state")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`讀取十三支房間失敗：${error.message}`);
  return (data as ThRoom | null) ?? null;
}

/** 直接寫一個座位（只剩 db 層單元測試用；路由入座一律走 lobbyJoin）：座位或玩家 id 重複回 "duplicate"，其他錯誤丟出 */
export async function insertPlayer(row: { room_id: string; player_id: string; name: string; seat: number; user_id: string | null }): Promise<"ok" | "duplicate"> {
  const { error } = await getSupabaseAdmin().from("th_players").insert(row);
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`加入十三支房間失敗：${error.message}`);
  }
  return "ok";
}

/**
 * 入座、離開（等人階段）：交給資料庫函式 th_lobby_join／th_lobby_leave（20261118_thirteen_lobby.sql），
 * 在同一個交易裡鎖住房間那一列再改座位和房間（房主交接、版本 +1、最後一人離開就刪房），和開局存檔、關房、閒置清除不會交錯。
 */
export type LobbyJoinResult =
  | { ok: true; rejoined: boolean; renamed?: boolean; seat: number; player_id: string; state_version?: number } // renamed：等人階段重新加入換了名字（20261119）
  | { error: "room_not_found" | "started" | "full" | "player_taken" | "host_reserved" };
export async function lobbyJoin(roomId: string, playerId: string, name: string, userId: string): Promise<LobbyJoinResult> {
  const { data, error } = await getSupabaseAdmin().rpc("th_lobby_join", { p_room_id: roomId, p_player_id: playerId, p_name: name, p_user_id: userId });
  if (error) throw new Error(`加入十三支房間失敗：${error.message}`);
  return data as LobbyJoinResult;
}
export type LobbyLeaveResult =
  | { ok: true; closed: boolean; host_id: string | null; player_id: string; seat: number; player_count?: number; state_version?: number }
  | { error: "not_in_room" | "game_in_progress" };
export async function lobbyLeave(roomId: string, userId: string): Promise<LobbyLeaveResult> {
  const { data, error } = await getSupabaseAdmin().rpc("th_lobby_leave", { p_room_id: roomId, p_user_id: userId });
  if (error) throw new Error(`離開十三支房間失敗：${error.message}`);
  return data as LobbyLeaveResult;
}

/** 房裡的座位，依座位排（查詢失敗丟出，不當成空房） */
export async function loadPlayers(roomId: string): Promise<ThPlayer[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("th_players")
    .select("id, room_id, player_id, name, seat, user_id")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`查詢十三支玩家失敗：${error.message}`);
  return (data ?? []) as ThPlayer[];
}

/** 這個帳號目前坐著的十三支房間（找回房間用），最近有動作的在前；開局後座位以牌局狀態為準 */
export async function loadSeatsByUser(userId: string): Promise<{ roomId: string; code: string; status: ThRoom["status"]; seat: number; playerId: string }[]> {
  const db = getSupabaseAdmin();
  const { data: mine, error } = await db.from("th_players").select("room_id, player_id, seat").eq("user_id", userId);
  if (error) throw new Error(`查詢十三支座位失敗：${error.message}`);
  if (!mine?.length) return [];
  const { data: rooms, error: e2 } = await db.from("th_rooms").select("id, code, status, updated_at, game_state")
    .in("id", mine.map((p) => p.room_id));
  if (e2) throw new Error(`查詢十三支房間失敗：${e2.message}`);
  return (rooms ?? [])
    .map((r) => {
      const p = mine.find((x) => x.room_id === r.id)!;
      const seat = (r.game_state as ThirteenGameState | null)?.players?.find((x) => x.id === p.player_id)?.seat ?? p.seat;
      return { roomId: r.id as string, code: r.code as string, status: r.status as ThRoom["status"], seat, playerId: p.player_id as string, at: r.updated_at as string };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ at: _at, ...x }) => x);
}

/** 閒置太久的房間（規則同麻將 sweepIdleRooms）：等人中 waitingBefore 之前、其他狀態 activeBefore 之前就沒更新過。row_version 給關房時比對 */
export async function listIdleThirteenRooms(waitingBefore: string, activeBefore: string, limit: number): Promise<(ThRoom & { row_version: number })[]> {
  const db = getSupabaseAdmin();
  const cols = "id, code, status, host_id, game_state, row_version";
  const [w, a] = await Promise.all([
    db.from("th_rooms").select(cols).eq("status", "waiting").lt("updated_at", waitingBefore).order("updated_at", { ascending: true }).limit(limit),
    db.from("th_rooms").select(cols).neq("status", "waiting").lt("updated_at", activeBefore).order("updated_at", { ascending: true }).limit(limit),
  ]);
  if (w.error || a.error) throw new Error(`查詢閒置十三支房間失敗：${(w.error ?? a.error)!.message}`);
  return [...(w.data ?? []), ...(a.data ?? [])].slice(0, limit).map((r) => ({ ...r, row_version: Number(r.row_version) })) as (ThRoom & { row_version: number })[];
}

/**
 * 樂觀鎖寫入：只有資料庫裡的 stateVersion 仍是 baseVersion（讀出時的版本）才寫入，寫入時版本 +1；
 * 否則丟 StateConflictError，不寫任何東西。回傳存好的版本號。
 */
export async function saveGameStateIfUnchanged(
  roomId: string,
  baseVersion: number,
  state: ThirteenGameState,
  status?: ThRoom["status"],
): Promise<number> {
  const next = { ...state, stateVersion: baseVersion + 1 };
  const update: Record<string, unknown> = { game_state: next };
  if (status) update.status = status;
  const { data, error } = await getSupabaseAdmin()
    .from("th_rooms")
    .update(update)
    .eq("id", roomId)
    .eq("game_state->>stateVersion", String(baseVersion))
    .select("id");
  if (error) throw new Error(`儲存十三支牌局失敗：${error.message}`);
  if (!data || data.length === 0) throw new StateConflictError();
  state.stateVersion = next.stateVersion;
  return next.stateVersion;
}

/**
 * 從牌局狀態組出一筆對局紀錄（交給 closeRoom("thirteen", …)）；一局都沒打完回 null（只關房、不記紀錄）。
 * 麻將專用的圈數、底、台填 null，十三支的設定放 settings。
 */
export function buildThirteenRecord(roomId: string, roomCode: string, s: ThirteenGameState, endReason: EndReason): MatchRecordInput | null {
  if (s.hands.length === 0) return null;
  return {
    game: "thirteen",
    roomId,
    roomCode,
    startedAt: s.startedAt,
    endReason,
    totalRounds: null,
    basePoints: null,
    fanPoints: null,
    // stats：整場累計（每家打槍、被打槍、全壘打、被全壘打次數和總分），總結算畫面和對局紀錄用（2026-11-18）
    settings: { arrangeSec: s.settings.arrangeSec, totalHands: s.settings.totalHands, baseScore: baseScoreOf(s.settings), stats: matchStats(s) },
    handsPlayed: s.hands.length,
    players: s.players.map((p) => ({
      seat: p.seat,
      playerName: p.name,
      playerId: p.id,
      userId: p.userId,
      totalScore: s.playerScores[p.seat] ?? 0,
    })),
  };
}

export type CloseResult = "closed" | "already_closed" | "changed" | "not_found";

/**
 * 寫對局紀錄＋刪房（同一個交易，close_room_with_record 的 thirteen 分支）：牌局版本不是 expectVersion 就不關（回 changed）。
 * 閒置清除改用 expectRowVersion（選中時的 row_version；中間有任何寫入就不關），這時 expectVersion 給 null。
 * 紀錄內容的欄位和 lib/records/store.ts closeRoom 送的一樣；十三支自己呼叫，流程測試才能跑在真的 migration 上。
 */
export async function closeThirteen(roomId: string, rec: MatchRecordInput | null, expectVersion: number | null, expectRowVersion: number | null = null): Promise<CloseResult> {
  const { data, error } = await getSupabaseAdmin().rpc("close_room_with_record", {
    p_game: "thirteen",
    p_room_id: roomId,
    p_record: rec
      ? {
          room_code: rec.roomCode, started_at: rec.startedAt, end_reason: rec.endReason,
          total_rounds: rec.totalRounds, base_points: rec.basePoints, fan_points: rec.fanPoints,
          settings: rec.settings, hands_played: rec.handsPlayed,
          players: rec.players.map((p) => ({ seat: p.seat, player_name: p.playerName, player_id: p.playerId, user_id: p.userId ?? null, total_score: p.totalScore })),
        }
      : null,
    p_expected_row_version: expectRowVersion,
    p_expected_version: expectVersion,
  });
  if (error) throw new Error(`close_room_with_record 失敗：${error.message}`);
  return data as CloseResult;
}

/** 房間已經關掉時，用房間 id 找這場的紀錄（重新整理、晚到的請求用）；沒有回 null。finalHand：最後亮的那一局（有的話）；stats：整場累計 */
export async function findThirteenRecord(roomId: string): Promise<(MatchRecordSummary & { finalHand: unknown; stats: unknown }) | null> {
  const db = getSupabaseAdmin();
  const { data: m, error } = await db.from("match_records").select("id, room_code, end_reason, ended_at, settings")
    .eq("game", "thirteen").eq("room_id", roomId).maybeSingle();
  if (error) throw new Error(`讀取十三支紀錄失敗：${error.message}`);
  if (!m) return null;
  const { data: ps, error: e2 } = await db.from("match_record_players").select("seat, player_name, total_score")
    .eq("match_id", m.id).order("seat", { ascending: true });
  if (e2) throw new Error(`讀取十三支紀錄失敗：${e2.message}`);
  return { game: "thirteen", roomCode: m.room_code, endReason: m.end_reason, endedAt: m.ended_at,
    players: (ps ?? []).map((p) => ({ seat: p.seat, playerName: p.player_name, totalScore: p.total_score })),
    finalHand: (m.settings as { finalHand?: unknown } | null)?.finalHand ?? null,
    stats: (m.settings as { stats?: unknown } | null)?.stats ?? null };
}

/** 我的十三支對局紀錄（一頁）＋累計（th_my_matches，20261118_thirteen_records.sql）。cursor＝上一頁最後一筆的 endedAt 和 id */
export interface ThirteenMyMatch {
  id: string; roomCode: string; endedAt: string; endReason: EndReason; handsPlayed: number | null;
  arrangeSec: number | null; totalHands: number | null; baseScore: number; myScore: number;
  players: { seat: number; playerName: string; totalScore: number; isMe: boolean }[];
}
export async function listMyThirteenMatches(userId: string, limit: number, cursor: { endedAt: string; id: string } | null):
  Promise<{ items: ThirteenMyMatch[]; summary: { matches: number; totalScore: number } }> {
  const { data, error } = await getSupabaseAdmin().rpc("th_my_matches", {
    p_user_id: userId, p_limit: limit, p_cursor_ended_at: cursor?.endedAt ?? null, p_cursor_id: cursor?.id ?? null,
  });
  if (error) throw new Error(`查詢十三支紀錄失敗：${error.message}`);
  return data as { items: ThirteenMyMatch[]; summary: { matches: number; totalScore: number } };
}

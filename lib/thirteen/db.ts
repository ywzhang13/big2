// 十三支房間的資料存取（只在伺服器用 service role 金鑰；資料表見 supabase/migrations/20261116_thirteen_rooms.sql）。
// 寫法照麻將 lib/mahjong/db.ts：牌局狀態整包放 th_rooms.game_state，用 stateVersion 做樂觀鎖，同時送出不會互相覆蓋。
// 和麻將不同：沒有 Redis 快取（十三支一局只有發牌、送出、亮牌幾次寫入，直接讀資料庫）。
// 關房＋寫對局紀錄走共用的 lib/records/store.ts closeRoom("thirteen", …)，紀錄內容用這裡的 buildThirteenRecord 組。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { MatchRecordInput, EndReason } from "@/lib/records/types";
import type { Card } from "./cards";
import type { Arrangement } from "./arrange";
import type { RoundResult } from "./score";

/** 開房可以選的理牌時間（秒） */
export const ARRANGE_SECS = [30, 45, 60] as const;
export type ArrangeSec = (typeof ARRANGE_SECS)[number];
export const isArrangeSec = (x: unknown): x is ArrangeSec => ARRANGE_SECS.includes(x as ArrangeSec);

export interface ThirteenSettings {
  arrangeSec: ArrangeSec; // 理牌時間
  totalHands: number;     // 這場打幾局
}

export interface ThirteenPlayerState {
  id: string;
  name: string;
  seat: number;
  userId: string | null;
  hand: Card[];                     // 這局發到的 13 張（亮牌前只能給本人看）
  arrangement: Arrangement | null;  // 送出的三墩（已通過 validateSubmission）；還沒送出＝null
  autoArranged: boolean;            // 理牌時間到了由系統自動排（autoArrange）
}

/** 一局打完的結果（scoreRound 的回傳整包存下來，結算畫面、紀錄都從這裡讀） */
export interface ThirteenHandResult {
  handNo: number;
  result: RoundResult;
}

export interface ThirteenGameState {
  stateVersion: number;             // 樂觀鎖：每次存檔 +1
  settings: ThirteenSettings;
  phase: "waiting" | "arranging" | "revealed";
  handNo: number;                   // 第幾局（等人時 0）
  startedAt: string | null;         // 這場開局時間（寫紀錄用）
  arrangeDeadline: number | null;   // 這局理牌截止時間（伺服器時間，毫秒）；過了就對還沒送出的人自動排
  players: ThirteenPlayerState[];   // 開局後才有，依座位排
  rest: Card[];                     // 沒發出去的 13 張：只存伺服器，不給前端
  hands: ThirteenHandResult[];      // 每局結果
  playerScores: number[];           // 多局累計（依座位）
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
export function newRoomState(settings: ThirteenSettings): ThirteenGameState {
  return { stateVersion: 0, settings, phase: "waiting", handNo: 0, startedAt: null, arrangeDeadline: null,
    players: [], rest: [], hands: [], playerScores: [0, 0, 0, 0] };
}

/** 條件寫入失敗：讀出後已經有人先寫了，呼叫端要重新讀取再做一次 */
export class StateConflictError extends Error {
  constructor() {
    super("十三支牌局狀態已被其他動作更新");
  }
}

/** 開房：房號重複回 "duplicate"（呼叫端換一個再試）；理牌時間不是 30／45／60 丟錯 */
export async function insertRoom(row: { code: string; host_id: string; settings: ThirteenSettings }): Promise<{ id: string } | "duplicate"> {
  if (!isArrangeSec(row.settings.arrangeSec)) throw new Error("理牌時間只能是 30、45 或 60 秒");
  const { data, error } = await getSupabaseAdmin()
    .from("th_rooms")
    .insert({ code: row.code, status: "waiting", host_id: row.host_id, game_state: newRoomState(row.settings) })
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

/** 坐下：座位或玩家 id 重複回 "duplicate"，其他錯誤丟出 */
export async function insertPlayer(row: { room_id: string; player_id: string; name: string; seat: number; user_id: string | null }): Promise<"ok" | "duplicate"> {
  const { error } = await getSupabaseAdmin().from("th_players").insert(row);
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`加入十三支房間失敗：${error.message}`);
  }
  return "ok";
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
    settings: { arrangeSec: s.settings.arrangeSec, totalHands: s.settings.totalHands },
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

// 回放的資料庫存取（只在伺服器用 service role）。SQL 都在 20261113_mahjong_replay.sql 的函式裡。
// 測試時整個檔案會被換成 tests/support/stub-replay-store.ts（在記憶體 PostgreSQL 跑同一份 migration 的函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ReplayRecord, ReplaySummary } from "./log";

/** 寫一局（同一局重送不會重複），順便清掉過期的；回傳新寫了幾列 */
export async function saveReplay(roomId: string, handNo: number, summary: ReplaySummary, data: ReplayRecord): Promise<number> {
  const { data: n, error } = await getSupabaseAdmin().rpc("mj_replay_save", { p_room: roomId, p_hand: handNo, p_summary: summary, p_data: data });
  if (error) throw new Error(`寫入回放失敗：${error.message}`);
  return Number(n) || 0;
}

export interface ReplayMatch {
  roomId: string;
  roomCode: string;
  endedAt: string;
  expiresAt: string;
  mySeat: number | null;  // 這位帳號在這場坐哪裡；沒上桌＝null
  expired: boolean;
  players: { seat: number; name: string }[];
}
const iso = (v: unknown) => new Date(v as string).toISOString();

/** 這一場（match_records.id）的回放權限資料；找不到（還沒結束、不是麻將）回 null */
export async function findReplayMatch(matchId: string, userId: string): Promise<ReplayMatch | null> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_replay_match", { p_match: matchId, p_user: userId });
  if (error) throw new Error(`查詢回放場次失敗：${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    roomId: String(r.room_id), roomCode: String(r.room_code), endedAt: iso(r.ended_at), expiresAt: iso(r.expires_at),
    mySeat: r.my_seat == null ? null : Number(r.my_seat), expired: !!r.expired,
    players: (r.players as { seat: number; name: string }[]) ?? [],
  };
}

export async function listReplayHands(roomId: string): Promise<{ handNo: number; summary: ReplaySummary; recordedAt: string }[]> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_replay_hands", { p_room: roomId });
  if (error) throw new Error(`查詢回放列表失敗：${error.message}`);
  return ((data ?? []) as { hand_no: number; summary: ReplaySummary; recorded_at: string }[])
    .map((r) => ({ handNo: Number(r.hand_no), summary: r.summary, recordedAt: iso(r.recorded_at) }));
}

export async function loadReplayHand(roomId: string, handNo: number): Promise<ReplayRecord | null> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_replay_hand", { p_room: roomId, p_hand: handNo });
  if (error) throw new Error(`讀取回放失敗：${error.message}`);
  return (data as ReplayRecord | null) ?? null;
}

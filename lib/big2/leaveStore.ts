// 大老二「等人階段退出房間」的資料存取（/api/game/leave 用）。和其他大老二路由一樣用公開金鑰
// （big2_rooms／big2_players 的 RLS 允許公開金鑰讀寫，正式庫 2026-10-24 確認過）。
// 測試時整個檔案換成 tests/support/stub-big2-leave-store.ts 的記憶體版本。
import { getSupabaseServer } from "@/lib/supabase-server";

export interface Big2LeaveRoom {
  id: string;
  code: string;
  status: string;
  host_id: string | null;
  scores: Record<string, number> | null;
  row_version: number;
}

export async function loadRoom(roomId: string): Promise<Big2LeaveRoom | null> {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .select("id, code, status, host_id, scores, row_version")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(`查詢房間失敗：${error.message}`);
  return (data as Big2LeaveRoom | null) ?? null;
}

/** 房裡的座位，最早加入的在前（房主轉交給最早加入、還在房裡的人） */
export async function loadPlayers(roomId: string): Promise<{ player_id: string; seat: number; name: string; created_at: string }[]> {
  const { data, error } = await getSupabaseServer()
    .from("big2_players")
    .select("player_id, seat, name, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .order("seat", { ascending: true });
  if (error) throw new Error(`查詢玩家失敗：${error.message}`);
  return data ?? [];
}

/**
 * 先佔住房間：只有 row_version 還是讀到的值（中間沒有人動過，例如開始發牌）才寫入，
 * 寫入後 trigger 會把 row_version +1。回傳新的 row_version；條件不成立回 null（呼叫端重讀再做）。
 */
export async function claimRoom(roomId: string, rowVersion: number, patch: Record<string, unknown>): Promise<number | null> {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .update(patch)
    .eq("id", roomId)
    .eq("row_version", rowVersion)
    .in("status", ["waiting", "ready_check"])
    .select("row_version");
  if (error) throw new Error(`更新房間失敗：${error.message}`);
  return data && data.length > 0 ? Number(data[0].row_version) : null;
}

/** 離座：刪掉這個玩家的座位，回傳刪了幾筆 */
export async function deletePlayer(roomId: string, playerId: string): Promise<number> {
  const { data, error } = await getSupabaseServer().from("big2_players").delete().eq("room_id", roomId).eq("player_id", playerId).select("id");
  if (error) throw new Error(`退出房間失敗：${error.message}`);
  return data?.length ?? 0;
}

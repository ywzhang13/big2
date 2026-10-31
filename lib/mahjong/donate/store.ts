// 斗內（自摸次數）的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-donate-store.ts（照樣跑真的 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** 記下一局的自摸者（同一局重複呼叫不會多記），回傳新記了幾筆 */
export async function recordZimo(roomId: string, handNo: number, userIds: string[]): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_zimo_record", { p_room_id: roomId, p_hand_no: handNo, p_user_ids: userIds });
  if (error) throw new Error(`記錄自摸失敗：${error.message}`);
  return Number(data) || 0;
}

/** 這個帳號目前的自摸次數（還欠的＋上次歸零之後的） */
export async function countZimo(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_donate_count", { p_user_id: userId });
  if (error) throw new Error(`查詢自摸次數失敗：${error.message}`);
  return Math.max(0, Number(data) || 0);
}

/** 斗內卡要不要出現：目前次數和玩家看過的次數（count > seen 才出現） */
export async function donateStatus(userId: string): Promise<{ count: number; seen: number }> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_donate_status", { p_user: userId });
  if (error) throw new Error(`查詢斗內卡狀態失敗：${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { count: number; seen: number } | undefined;
  return { count: Math.max(0, Number(r?.count) || 0), seen: Math.max(0, Number(r?.seen) || 0) };
}
/** 玩家看過斗內卡（收起）：看過次數＝max(原本, min(看到的數字, 目前次數))，不改次數 */
export async function markSeen(userId: string, count: number): Promise<{ count: number; seen: number }> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_donate_seen", { p_user: userId, p_count: count });
  if (error) throw new Error(`記錄看過斗內卡失敗：${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { count: number; seen: number } | undefined;
  return { count: Math.max(0, Number(r?.count) || 0), seen: Math.max(0, Number(r?.seen) || 0) };
}

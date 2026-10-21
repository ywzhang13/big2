// 斗內（自摸次數）的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-donate-store.ts（照樣跑真的 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** 記下一局的自摸者（同一局重複呼叫不會多記），回傳新記了幾筆 */
export async function recordZimo(roomId: string, handNo: number, userIds: string[]): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_zimo_record", { p_room_id: roomId, p_hand_no: handNo, p_user_ids: userIds });
  if (error) throw new Error(`記錄自摸失敗：${error.message}`);
  return Number(data) || 0;
}

/** 這個帳號上次按斗內之後的自摸次數 */
export async function countZimo(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_donate_count", { p_user_id: userId });
  if (error) throw new Error(`查詢自摸次數失敗：${error.message}`);
  return Math.max(0, Number(data) || 0);
}

/** 按了斗內：歸零點設成現在，回傳歸零後的次數（正常是 0） */
export async function ackDonate(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_donate_ack", { p_user_id: userId });
  if (error) throw new Error(`斗內歸零失敗：${error.message}`);
  return Math.max(0, Number(data) || 0);
}

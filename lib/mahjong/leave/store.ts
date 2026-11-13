// 解散投票判斷用：這房每個帳號最後一次聊天、丟互動的時間（從既有的冷卻紀錄讀，不另外寫）。
// 測試時整個檔案會被換成 tests/support/stub-leave-store.ts。
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** userId → 最後一次聊天或丟互動的時間（毫秒）。查不到不擋投票，只是不算這兩種操作 */
export async function socialActivityByUser(roomId: string): Promise<Record<string, number>> {
  const db = getSupabaseAdmin();
  const [chat, fx] = await Promise.all([
    db.from("mj_chat_rate").select("user_id, last_at").eq("room_id", roomId),
    db.from("mj_effect_rate").select("subject_id, slot, last_at").eq("room_id", roomId).in("slot", ["send_light", "send_heavy"]),
  ]);
  if (chat.error) throw new Error(`讀取聊天時間失敗：${chat.error.message}`);
  if (fx.error) throw new Error(`讀取互動時間失敗：${fx.error.message}`);
  const out: Record<string, number> = {};
  const put = (u: string, t: string) => { const ms = Date.parse(t); if (ms > (out[u] ?? 0)) out[u] = ms; };
  for (const r of (chat.data ?? []) as { user_id: string; last_at: string }[]) put(r.user_id, r.last_at);
  for (const r of (fx.data ?? []) as { subject_id: string; last_at: string }[]) put(r.subject_id, r.last_at);
  return out;
}

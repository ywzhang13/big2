// 特效冷卻的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-effects-store.ts（照樣跑真的 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { EFFECT_GROUP, GROUP_COOLDOWN_MS, GROUP_PROTECT_MS, toResult, type EffectKind, type TakeResult } from "./rules";

/** 檢查發送者冷卻和目標保護期，都過了才記下這次（同一個資料庫交易）。擋下時什麼都不記 */
export async function takeEffect(roomId: string, senderId: string, targetId: string, kind: EffectKind): Promise<TakeResult> {
  const group = EFFECT_GROUP[kind];
  const { data, error } = await getSupabaseAdmin().rpc("mj_effect_take", {
    p_room_id: roomId,
    p_sender_id: senderId,
    p_target_id: targetId,
    p_group: group,
    p_cooldown_ms: GROUP_COOLDOWN_MS[group],
    p_protect_ms: GROUP_PROTECT_MS[group],
  });
  if (error) throw new Error(`檢查特效冷卻失敗：${error.message}`);
  return toResult(data);
}

/** 房間關閉：刪掉這房的發送冷卻和接收保護紀錄 */
export async function deleteRoomEffects(roomId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("mj_effect_rate").delete().eq("room_id", roomId);
  if (error) throw new Error(`刪除特效冷卻紀錄失敗：${error.message}`);
}

// 偏好設定的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-prefs-store.ts（跑真的 migration）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { AccountPrefs } from "./rules";

export async function loadAccountPrefs(userId: string): Promise<unknown | null> {
  const { data, error } = await getSupabaseAdmin().from("mj_user_prefs").select("prefs").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`讀取偏好設定失敗：${error.message}`);
  return data?.prefs ?? null;
}

/** 存一份（同一個帳號重送就是覆蓋同一列） */
export async function saveAccountPrefs(userId: string, prefs: AccountPrefs): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("mj_user_prefs")
    .upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`儲存偏好設定失敗：${error.message}`);
}

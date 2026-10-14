import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

/**
 * 伺服器專用的 Supabase client（service role，會略過 RLS）。
 * 金鑰只從伺服器端環境變數 SUPABASE_SERVICE_ROLE_KEY 讀取，絕不能加 NEXT_PUBLIC_ 前綴、不能送到前端。
 * 沒設定金鑰時丟錯誤：寫紀錄失敗 → 不刪房（安全的預設）。
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定，無法寫入對局紀錄");
  }
  adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

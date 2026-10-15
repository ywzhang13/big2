// 主畫面 App 登入交接的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-pairing-store.ts 的記憶體版本。
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface PairingRow {
  pollHash: string;
  status: "pending" | "ready";
  expiresAt: string;
}
export interface PairingSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // access token 到期（Unix 秒）
}

export async function insertPairing(codeHash: string, pollHash: string, expiresAt: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("auth_pairings").insert({ code_hash: codeHash, poll_hash: pollHash, expires_at: expiresAt });
  if (error) throw new Error(`建立配對失敗：${error.message}`);
}

/** 刪掉過期的配對（含已認領但沒被領走的登入憑證） */
export async function deleteExpired(nowIso: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("auth_pairings").delete().lte("expires_at", nowIso);
  if (error) throw new Error(`清理配對失敗：${error.message}`);
}

export async function getPairing(codeHash: string): Promise<PairingRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("auth_pairings").select("poll_hash, status, expires_at").eq("code_hash", codeHash).maybeSingle();
  if (error) throw new Error(`查詢配對失敗：${error.message}`);
  return data ? { pollHash: data.poll_hash, status: data.status, expiresAt: data.expires_at } : null;
}

/** 等待中、還沒過期才認領得到（同一個條件寫入，兩個人同時認領只有一個成功） */
export async function markReady(codeHash: string, userId: string, payload: string, nowIso: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("auth_pairings").update({ status: "ready", user_id: userId, payload })
    .eq("code_hash", codeHash).eq("status", "pending").gt("expires_at", nowIso).select("code_hash");
  if (error) throw new Error(`認領配對失敗：${error.message}`);
  return (data?.length ?? 0) === 1;
}

/** 已認領、密鑰正確、還沒過期：整筆刪除並回傳登入憑證（只拿得到一次） */
export async function takeReady(codeHash: string, pollHash: string, nowIso: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("auth_pairings").delete()
    .eq("code_hash", codeHash).eq("poll_hash", pollHash).eq("status", "ready").gt("expires_at", nowIso).select("payload");
  if (error) throw new Error(`領取配對失敗：${error.message}`);
  return (data?.[0]?.payload as string | undefined) ?? null;
}

/** 領取密鑰錯一次，回傳累計次數 */
export async function addPollFailure(codeHash: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("auth_pairing_poll_fail", { p_code_hash: codeHash });
  if (error) throw new Error(`記錄配對錯誤失敗：${error.message}`);
  return (data as number | null) ?? 0;
}

export async function deletePairing(codeHash: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("auth_pairings").delete().eq("code_hash", codeHash);
  if (error) throw new Error(`刪除配對失敗：${error.message}`);
}

/** 用 Safari 那邊的 refresh token 換一組新的登入憑證（確認是誰，也讓交出去的這組只有主畫面 App 有）；無效回 null */
export async function refreshSession(refreshToken: string): Promise<PairingSession | null> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) return null;
  const s = data.session;
  return { userId: data.user.id, accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at ?? 0 };
}

// LINE 授權和帳號照片的資料存取（伺服器專用，service role）。表和函式見 supabase/migrations/20261119_line_tokens.sql。
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** 伺服器時間（毫秒）；測試會換掉 */
export const lineClock = { now: () => Date.now() };

/** 存授權：這次登入已經登出過（晚到的請求）回 revoked，不存 */
export async function saveSealed(userId: string, sealed: string, sessionKey: string): Promise<{ ok: true } | { ok: false; reason: "revoked" }> {
  const { data, error } = await getSupabaseAdmin().rpc("line_token_save", { p_user: userId, p_sealed: sealed, p_session: sessionKey });
  if (error) throw new Error(`存 LINE 授權失敗：${error.message}`);
  return data as { ok: true } | { ok: false; reason: "revoked" };
}

/**
 * 取出授權並記下這次的時間：沒存過回 none（不吃冷卻）；冷卻中回 cooldown（冷卻和授權分開存，刪了再存不會重置）。
 * gen＝這筆授權的版本，之後換存、作廢都要帶回來，授權在這中間被換掉（登出、重新登入）就不會動到新的
 */
export async function claimSealed(userId: string, cooldownSeconds: number): Promise<{ status: "ok"; sealed: string; gen: number } | { status: "cooldown" | "none" }> {
  const { data, error } = await getSupabaseAdmin().rpc("line_token_claim",
    { p_user: userId, p_cooldown_seconds: cooldownSeconds, p_now: new Date(lineClock.now()).toISOString() });
  if (error) throw new Error(`讀 LINE 授權失敗：${error.message}`);
  const d = data as { status: "ok"; sealed: string; gen: number | string } | { status: "cooldown" | "none" };
  return d.status === "ok" ? { ...d, gen: Number(d.gen) } : d;
}

/** LINE 換發新授權：授權還是 claim 時那一筆才換存；回傳有沒有存 */
export async function rotateSealed(userId: string, sealed: string, gen: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("line_token_rotate", { p_user: userId, p_sealed: sealed, p_gen: gen });
  if (error) throw new Error(`換存 LINE 授權失敗：${error.message}`);
  return data === true;
}

/** 授權失效（LINE invalid_grant、解不開）：只刪 claim 時那一筆 */
export async function invalidateSealed(userId: string, gen: number): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("line_token_invalidate", { p_user: userId, p_gen: gen });
  if (error) throw new Error(`作廢 LINE 授權失敗：${error.message}`);
}

/** 登出：這次登入記成已登出（之後晚到的保存不收），只刪這次登入存的授權 */
export async function deleteSealed(userId: string, sessionKey: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("line_token_delete", { p_user: userId, p_session: sessionKey });
  if (error) throw new Error(`刪 LINE 授權失敗：${error.message}`);
}

/** 帳號目前的 LINE userId（user_metadata.sub）和照片網址 */
export async function loadAccount(userId: string): Promise<{ lineSub: string | null; picture: string | null; meta: Record<string, unknown> } | null> {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  return { lineSub: typeof meta.sub === "string" ? meta.sub : null, picture: typeof meta.picture === "string" ? meta.picture : null, meta };
}

/** 寫回照片：送完整的 user_metadata（只換 picture），不靠伺服器合併，其他欄位一定保留 */
export async function savePicture(userId: string, meta: Record<string, unknown>, picture: string): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, { user_metadata: { ...meta, picture } });
  if (error) throw new Error(`更新照片失敗：${error.message}`);
}

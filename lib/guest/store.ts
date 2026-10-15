// 遊客登入的資料庫／Supabase Auth 存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-guest-store.ts 的記憶體版本。
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface GuestSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // access token 到期（Unix 秒）
}

/** 這個 key 現在是否被鎖：回傳鎖到的時間（ISO），沒鎖回 null */
export async function lockedUntil(key: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("guest_login_locked_until", { p_key: key });
  if (error) throw new Error(`查詢猜錯次數失敗：${error.message}`);
  return (data as string | null) ?? null;
}

/** 記一次猜錯；累積到上限就鎖住，回傳鎖到的時間（ISO），沒鎖回 null */
export async function recordFailure(key: string, max: number, windowSeconds: number, lockSeconds: number): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("guest_login_fail", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
    p_lock_seconds: lockSeconds,
  });
  if (error) throw new Error(`記錄猜錯次數失敗：${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * 建一個遊客帳號並登入，回傳 session。
 * 遊客標記放在 app_metadata（只有 service role 改得了，使用者自己改不了）。
 * email／密碼是隨機產生的，只在這裡用一次就丟掉；遊客之後靠 refresh token 續用。
 */
export async function createGuestUser(displayName: string, expiresAtIso: string): Promise<GuestSession> {
  const email = `guest-${randomUUID()}@guest.example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: displayName },
    app_metadata: { guest: true, guest_expires_at: expiresAtIso },
  });
  if (created.error || !created.data.user) throw new Error(`建立遊客失敗：${created.error?.message}`);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    await getSupabaseAdmin().auth.admin.deleteUser(created.data.user.id);
    throw new Error(`遊客登入失敗：${signed.error?.message}`);
  }
  const s = signed.data.session;
  return { userId: created.data.user.id, accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at ?? 0 };
}

/** 所有遊客帳號（id 和到期時間） */
export async function listGuests(): Promise<{ id: string; expiresAt: string | null }[]> {
  const out: { id: string; expiresAt: string | null }[] = [];
  const admin = getSupabaseAdmin();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`列出帳號失敗：${error.message}`);
    for (const u of data.users) {
      if (u.app_metadata?.guest === true) out.push({ id: u.id, expiresAt: (u.app_metadata.guest_expires_at as string) ?? null });
    }
    if (data.users.length < 1000) return out;
  }
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(id);
  if (error) throw new Error(`刪除遊客失敗：${error.message}`);
}

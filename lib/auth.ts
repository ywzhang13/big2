// 伺服器端確認「這個請求是誰」：前端用 Supabase Auth（LINE 登入或遊客登入）拿到的 access token，
// 放在 Authorization: Bearer <token> 送來。這裡向 Supabase Auth 驗證後回傳使用者。
// 測試時整個檔案會被換成 tests/support/stub-auth.ts。
import { getSupabaseServer } from "@/lib/supabase-server";

export interface AuthUser {
  id: string; // Supabase auth user id（uuid）；寫進 mj_players.user_id、match_record_players.user_id
  displayName: string | null;
  pictureUrl: string | null;
  isGuest: boolean; // 遊客登入（只給測試用）：app_metadata.guest，只有伺服器設得了
}

// 同一個 token 短時間內重複驗證只問一次 Supabase（每個伺服器行程各自一份）
const CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map<string, { user: AuthUser; until: number }>();

function tokenExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** 沒帶 token、token 無效或過期 → null */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const m = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.until > now) return hit.user;

  const { data, error } = await getSupabaseServer().auth.getUser(token);
  if (error || !data.user) return null;
  const app = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const isGuest = app.guest === true;
  // 遊客過期就不再承認（帳號之後由清理刪掉）
  const guestExpiry = isGuest ? Date.parse(String(app.guest_expires_at ?? "")) : NaN;
  if (isGuest && !(guestExpiry > now)) return null;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const user: AuthUser = {
    id: data.user.id,
    displayName: str(meta.name) ?? str(meta.full_name) ?? str(meta.nickname),
    pictureUrl: str(meta.picture) ?? str(meta.avatar_url),
    isGuest,
  };
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(token, { user, until: Math.min(now + CACHE_MS, tokenExpiryMs(token) || now + CACHE_MS, isGuest ? guestExpiry : Infinity) });
  return user;
}

// 跟 LINE 要新照片（伺服器專用）：refresh token 換 access token，再用 access token 讀個人資料。
// 需要 LINE Login channel 的 LINE_CHANNEL_ID、LINE_CHANNEL_SECRET（和 Supabase 後台 LINE 登入設定的同一組）。
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const PROFILE_URL = "https://api.line.me/v2/profile";
const TIMEOUT_MS = 5000;

export type LineResult<T> = { ok: true; value: T } | { ok: false; invalid: boolean };

export function lineConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.LINE_CHANNEL_ID && !!env.LINE_CHANNEL_SECRET;
}

/** refresh token → access token（LINE 換發新的 refresh token 時一併回傳）。invalid＝授權已失效或被撤銷，不用再試 */
export async function refreshLineToken(refreshToken: string): Promise<LineResult<{ accessToken: string; refreshToken: string | null }>> {
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken,
        client_id: process.env.LINE_CHANNEL_ID ?? "", client_secret: process.env.LINE_CHANNEL_SECRET ?? "" }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await r.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; error?: unknown };
    if (!r.ok || typeof body.access_token !== "string") return { ok: false, invalid: r.status === 400 && body.error === "invalid_grant" };
    return { ok: true, value: { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null } };
  } catch {
    return { ok: false, invalid: false };
  }
}

/** access token → LINE userId 和照片網址（沒設大頭照時 pictureUrl＝null） */
export async function fetchLineProfile(accessToken: string): Promise<LineResult<{ userId: string; pictureUrl: string | null }>> {
  try {
    const r = await fetch(PROFILE_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await r.json().catch(() => ({}))) as { userId?: unknown; pictureUrl?: unknown };
    if (!r.ok || typeof body.userId !== "string") return { ok: false, invalid: false };
    const pic = typeof body.pictureUrl === "string" && body.pictureUrl.startsWith("https://") ? body.pictureUrl : null;
    return { ok: true, value: { userId: body.userId, pictureUrl: pic } };
  } catch {
    return { ok: false, invalid: false };
  }
}

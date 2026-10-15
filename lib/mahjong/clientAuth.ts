// 麻將前端的登入共用：每次呼叫麻將 API 都帶 Supabase Auth（LINE 登入）的 token。
// 大老二（/api/game/*）不要用這裡，大老二不登入。
import { getSupabase } from "@/lib/supabase";

/** Supabase Dashboard 設定的自訂 OIDC provider（老闆設定的 identifier 不同時改這裡） */
export const LINE_PROVIDER = "custom:line";

export const ROOM_CODE_RE = /^\d{4}$/;

/** 每次都向 supabase-js 拿（它會自動更新快過期的 token），不自己存 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 麻將 API 的 fetch：JSON ＋ 登入 token */
export async function mjFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) },
  });
}

/**
 * LINE 登入完要回來的網址：只會是本站的 /mahjong，房號只接受 4 位數字，放在 query
 * （#room= 是 hash，登入流程會被 token 蓋掉，伺服器也收不到）。不接受任何外部傳入的網址。
 */
export function loginReturnUrl(roomCode: string | null): string {
  const url = new URL("/mahjong", window.location.origin);
  if (roomCode && ROOM_CODE_RE.test(roomCode)) url.searchParams.set("room", roomCode);
  return url.toString();
}

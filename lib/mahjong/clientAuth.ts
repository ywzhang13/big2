// 麻將前端的登入共用：每次呼叫麻將 API 都帶 Supabase Auth（LINE 登入或遊客登入）的 token。
// 大老二（/api/game/*）不要用這裡，大老二不登入。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

/** Supabase Dashboard 設定的自訂 OIDC provider（老闆設定的 identifier 不同時改這裡） */
export const LINE_PROVIDER = "custom:line";

export const ROOM_CODE_RE = /^\d{4}$/;

// ---------------------------------------------------------------------------
// 遊客登入（只給測試用，入口是 /mahjong?guest=1）：session 存在 sessionStorage，
// 每個分頁各自一個遊客；同一個分頁的暱稱、玩家 id 也改存 sessionStorage，4 個分頁才會是 4 個人
// ---------------------------------------------------------------------------
const GUEST_STORAGE_KEY = "mj-guest";
let guestClient: SupabaseClient | null = null;

export function getGuestClient(): SupabaseClient {
  if (guestClient) return guestClient;
  guestClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storage: window.sessionStorage, storageKey: GUEST_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return guestClient;
}

/** 這個分頁是不是遊客（有遊客 session） */
export function isGuestTab(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(GUEST_STORAGE_KEY) !== null;
}

/** 暱稱、玩家 id 存哪裡：遊客分頁用 sessionStorage，其他照舊 localStorage */
export function mjStorage(): Storage {
  return isGuestTab() ? window.sessionStorage : window.localStorage;
}

/** 每次都向 supabase-js 拿（它會自動更新快過期的 token），不自己存。這個分頁有遊客 session 就用遊客的 */
export async function authHeaders(): Promise<Record<string, string>> {
  const client = isGuestTab() ? getGuestClient() : getSupabase();
  const { data } = await client.auth.getSession();
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

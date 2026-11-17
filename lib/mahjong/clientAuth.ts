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

/** 登入用、不能帶回去的查詢參數（主畫面 App 交接代碼、登入失敗訊息；房號另外處理） */
const LOGIN_PARAMS = ["pairing", "error", "error_code", "error_description", "room"];
/** 可以回去的站內頁面路徑：只有英數、-、_ 組成的一段段路徑（擋掉 //、\、%、..、/api/…，不會被導到站外） */
const SAFE_PATH = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

/**
 * LINE 登入完要回來的網址（審伯 2026-11-18 必修 5：十三支登入後要回十三支、保留邀請房號）。只會是本站：
 *   ・/mahjong 開頭的頁面（大廳、觀戰、管理頁）：照舊回 /mahjong，行為和以前完全一樣
 *   ・其他站內頁面（例如 /thirteen）：回發起登入的那一頁，保留它的查詢參數（登入用的參數不帶）
 *   ・路徑怪、或不是本站：一律回 /mahjong
 * 房號只接受 4 位數字，放在 query 的 room（#room= 是 hash，登入流程會被 token 蓋掉，伺服器也收不到）：
 * 呼叫端給的 roomCode 優先，沒給就沿用網址上的 #room= 或 ?room=。不接受任何外部傳入的網址。
 */
export function loginReturnUrl(roomCode: string | null): string {
  const { origin, href } = window.location;
  const here = new URL(href);
  const hashRoom = /(?:^#|[#&])room=(\d{4})(?:&|$)/.exec(here.hash)?.[1] ?? null;
  const room = [roomCode, hashRoom, here.searchParams.get("room")].find((r): r is string => !!r && ROOM_CODE_RE.test(r)) ?? null;
  const sameSite = here.origin === origin && SAFE_PATH.test(here.pathname) && !here.pathname.startsWith("/api/");
  const url = new URL("/mahjong", origin);
  if (sameSite && here.pathname !== "/mahjong" && !here.pathname.startsWith("/mahjong/")) {
    url.pathname = here.pathname; // 只設 pathname（不用字串拼接），網址一定還是本站
    for (const [k, v] of here.searchParams) if (!LOGIN_PARAMS.includes(k)) url.searchParams.append(k, v);
  }
  if (room && (url.pathname !== "/mahjong" || roomCode === room)) url.searchParams.set("room", room);
  return url.toString();
}

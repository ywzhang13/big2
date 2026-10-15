// 遊客登入（只給老闆自己測試用）：知道測試密碼的人才能建立遊客身分，之後和 LINE 登入的玩家一樣打麻將。
// 測試密碼只放在伺服器的環境變數 GUEST_LOGIN_PASSWORD；沒設定時整個功能關閉。
import { createHash, timingSafeEqual } from "node:crypto";
import * as store from "@/lib/guest/store";

/** 遊客身分有效多久（過期後伺服器不再承認，之後由清理刪掉） */
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
/** 猜錯限制：同一個 IP 15 分鐘內錯 5 次鎖 15 分鐘；全站 1 小時內錯 20 次鎖 1 小時（擋換 IP 一直猜） */
export const LIMITS = [
  { scope: "ip", max: 5, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
  { scope: "global", max: 20, windowSeconds: 60 * 60, lockSeconds: 60 * 60 },
] as const;

export function guestLoginEnabled(): boolean {
  return !!process.env.GUEST_LOGIN_PASSWORD;
}

/** Vercel 會把真正的來源 IP 放在 x-forwarded-for 的第一個 */
function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || request.headers.get("x-real-ip")?.trim() || "unknown";
}
const keysFor = (request: Request) => ({ ip: `ip:${clientIp(request)}`, global: "global" });

/** 固定時間比對（先各自取 sha256，長度一樣），不讓回應時間洩漏猜對了幾個字 */
function passwordMatches(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(process.env.GUEST_LOGIN_PASSWORD ?? "").digest();
  return timingSafeEqual(a, b);
}

export type GuestLoginResult =
  | { ok: true; session: store.GuestSession; displayName: string; expiresAt: string }
  | { ok: false; status: 401 | 404 | 429; error: "disabled" | "wrong_password" | "too_many_attempts"; retryAfter?: number };

/** 驗證測試密碼（有次數限制），對了就建立一個新的遊客並登入 */
export async function loginGuest(request: Request, password: unknown, name: unknown, nowMs = Date.now()): Promise<GuestLoginResult> {
  if (!guestLoginEnabled()) return { ok: false, status: 404, error: "disabled" };
  const keys = keysFor(request);
  // 鎖住時連對的密碼也不收（不然鎖了也能繼續猜）
  for (const key of [keys.ip, keys.global]) {
    const until = await store.lockedUntil(key);
    if (until) return { ok: false, status: 429, error: "too_many_attempts", retryAfter: Math.max(1, Math.ceil((Date.parse(until) - nowMs) / 1000)) };
  }
  if (typeof password !== "string" || !passwordMatches(password)) {
    let lockedTo: string | null = null;
    for (const l of LIMITS) {
      const until = await store.recordFailure(l.scope === "ip" ? keys.ip : keys.global, l.max, l.windowSeconds, l.lockSeconds);
      if (until) lockedTo = until;
    }
    if (lockedTo) return { ok: false, status: 429, error: "too_many_attempts", retryAfter: Math.max(1, Math.ceil((Date.parse(lockedTo) - nowMs) / 1000)) };
    return { ok: false, status: 401, error: "wrong_password" };
  }
  const displayName = typeof name === "string" && name.trim() ? name.trim().slice(0, 8) : `遊客${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = new Date(nowMs + GUEST_TTL_MS).toISOString();
  const session = await store.createGuestUser(displayName, expiresAt);
  return { ok: true, session, displayName, expiresAt };
}

/** 刪掉已經過期的遊客帳號（每次建立遊客時順便跑；也可以手動呼叫） */
export async function sweepExpiredGuests(nowMs = Date.now()): Promise<number> {
  let n = 0;
  for (const g of await store.listGuests()) {
    if (!g.expiresAt || Date.parse(g.expiresAt) <= nowMs) {
      await store.deleteUser(g.id);
      n++;
    }
  }
  return n;
}

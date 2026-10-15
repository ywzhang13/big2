// 測試用：lib/guest/store.ts 的記憶體版本。猜錯次數的規則和 SQL 函式 guest_login_fail 相同（SQL 本身另有 PGlite 測試）。
// 建立的遊客會登記到 stub-auth 的 tokens（token「guest-tok-N」），之後打 API 就是這個遊客。
import { tokens } from "./stub-auth";
import type { GuestSession } from "../../lib/guest/store";

export const clock = { now: () => Date.now() };
const attempts = new Map<string, { failures: number; windowStart: number; lockedUntil: number | null }>();
export const guests = new Map<string, { expiresAt: string; token: string }>();
let n = 0;

export function reset() {
  attempts.clear();
  guests.clear();
}
export async function lockedUntil(key: string) {
  const a = attempts.get(key);
  return a?.lockedUntil && a.lockedUntil > clock.now() ? new Date(a.lockedUntil).toISOString() : null;
}
export async function recordFailure(key: string, max: number, windowSeconds: number, lockSeconds: number) {
  const now = clock.now();
  const a = attempts.get(key) ?? { failures: 0, windowStart: now, lockedUntil: null };
  if (a.windowStart < now - windowSeconds * 1000) { a.failures = 0; a.windowStart = now; }
  a.failures++;
  if (a.failures >= max) { a.lockedUntil = now + lockSeconds * 1000; a.failures = 0; a.windowStart = now; }
  attempts.set(key, a);
  return a.lockedUntil && a.lockedUntil > now ? new Date(a.lockedUntil).toISOString() : null;
}
export async function createGuestUser(displayName: string, expiresAtIso: string): Promise<GuestSession> {
  const id = `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
  const token = `guest-tok-${n}`;
  tokens[token] = { id, displayName, pictureUrl: null, isGuest: true };
  guests.set(id, { expiresAt: expiresAtIso, token });
  return { userId: id, accessToken: token, refreshToken: `guest-refresh-${n}`, expiresAt: 0 };
}
export async function listGuests() {
  return [...guests.entries()].map(([id, g]) => ({ id, expiresAt: g.expiresAt }));
}
export async function deleteUser(id: string) {
  const g = guests.get(id);
  if (g) delete tokens[g.token];
  guests.delete(id);
}

// 測試用：lib/pairing/store.ts 的記憶體版本，條件和 SQL 相同（SQL 本身另有 PGlite 測試）。
// refreshSession：refreshTokens 裡登記的 refresh token 才有效，換到的新 access token 會登記到 stub-auth 的 tokens（之後打 API 就是這個人）
import { tokens } from "./stub-auth";
import type { AuthUser } from "../../lib/auth";
import type { PairingRow, PairingSession } from "../../lib/pairing/store";

export const rows = new Map<string, PairingRow & { userId: string | null; payload: string | null; pollFailures: number }>();
export const refreshTokens = new Map<string, AuthUser>(); // refresh token → 這個 token 屬於誰
let n = 0;

export function reset() { rows.clear(); refreshTokens.clear(); }
export async function insertPairing(codeHash: string, pollHash: string, expiresAt: string) {
  if (rows.has(codeHash)) throw new Error("duplicate key");
  rows.set(codeHash, { pollHash, status: "pending", expiresAt, userId: null, payload: null, pollFailures: 0 });
}
export async function deleteExpired(nowIso: string) {
  for (const [k, r] of rows) if (Date.parse(r.expiresAt) <= Date.parse(nowIso)) rows.delete(k);
}
export async function getPairing(codeHash: string) {
  const r = rows.get(codeHash);
  return r ? { pollHash: r.pollHash, status: r.status, expiresAt: r.expiresAt } : null;
}
export async function markReady(codeHash: string, userId: string, payload: string, nowIso: string) {
  const r = rows.get(codeHash);
  if (!r || r.status !== "pending" || Date.parse(r.expiresAt) <= Date.parse(nowIso)) return false;
  Object.assign(r, { status: "ready", userId, payload });
  return true;
}
export async function takeReady(codeHash: string, pollHash: string, nowIso: string) {
  const r = rows.get(codeHash);
  if (!r || r.pollHash !== pollHash || r.status !== "ready" || Date.parse(r.expiresAt) <= Date.parse(nowIso)) return null;
  rows.delete(codeHash);
  return r.payload;
}
export async function addPollFailure(codeHash: string) {
  const r = rows.get(codeHash);
  if (!r) return 0;
  return ++r.pollFailures;
}
export async function deletePairing(codeHash: string) { rows.delete(codeHash); }
export async function refreshSession(refreshToken: string): Promise<PairingSession | null> {
  const user = refreshTokens.get(refreshToken);
  if (!user) return null;
  refreshTokens.delete(refreshToken); // 用過就換掉（和 Supabase 一樣會輪替）
  const i = ++n;
  tokens[`paired-tok-${i}`] = user;
  refreshTokens.set(`paired-refresh-${i}`, user);
  return { userId: user.id, accessToken: `paired-tok-${i}`, refreshToken: `paired-refresh-${i}`, expiresAt: 0 };
}

// iPhone 主畫面 App 的 LINE 登入交接（一次性配對代碼＋背景輪詢）。
// 主畫面（獨立模式）和 Safari 的登入狀態分開：主畫面 App 先發起配對拿到「代碼＋領取密鑰」，
// 代碼跟著 LINE 登入流程到 Safari；Safari 登入完成後認領代碼，主畫面 App 用密鑰把登入領回去。
//   - 代碼和密鑰都是 32 bytes 亂數，資料庫只存雜湊；密鑰不出現在網址，只有發起的 App 有，所以光看到網址或代碼領不走
//   - 3 分鐘過期；領走就整筆刪除；過期的在下一次發起時清掉
//   - 登入憑證加密後才存；任何地方都不記 log
//   - 同一個 IP 錯太多次（認領或領取時代碼／密鑰不對、過期）就鎖住；同一筆密鑰錯 5 次整筆作廢
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as store from "@/lib/pairing/store";
import { lockedUntil, recordFailure } from "@/lib/guest/store"; // 猜錯次數共用 guest_login_attempts（key 加 pair 前綴）
import { clientIp } from "@/lib/guest/guest";

export const PAIRING_TTL_MS = 3 * 60 * 1000;
/** 同一個 IP：10 分鐘內錯 20 次鎖 10 分鐘；發起配對 10 分鐘內最多 20 次 */
export const FAIL_LIMIT = { max: 20, windowSeconds: 10 * 60, lockSeconds: 10 * 60 };
export const START_LIMIT = { max: 20, windowSeconds: 10 * 60, lockSeconds: 10 * 60 };
/** 同一筆配對的領取密鑰錯幾次就作廢 */
export const MAX_POLL_FAILURES = 5;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const isToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定，無法加密登入交接");
  return createHash("sha256").update(`auth-pairing:${secret}`).digest();
}
function encrypt(s: store.PairingSession): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(s), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
function decrypt(payload: string): store.PairingSession {
  const [iv, tag, body] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
}

type Fail = { ok: false; status: 400 | 403 | 404 | 429; error: string; retryAfter?: number };
const retryAfter = (until: string, nowMs: number) => Math.max(1, Math.ceil((Date.parse(until) - nowMs) / 1000));
const failKey = (request: Request) => `pair:${clientIp(request)}`;

/** 這個 IP 被鎖住了嗎 */
async function locked(k: string, nowMs: number): Promise<Fail | null> {
  const until = await lockedUntil(k);
  return until ? { ok: false, status: 429, error: "too_many_attempts", retryAfter: retryAfter(until, nowMs) } : null;
}
/** 記一次錯；剛好到上限就回 429，否則回原本的錯誤 */
async function fail(request: Request, nowMs: number, f: Fail): Promise<Fail> {
  const until = await recordFailure(failKey(request), FAIL_LIMIT.max, FAIL_LIMIT.windowSeconds, FAIL_LIMIT.lockSeconds);
  return until ? { ok: false, status: 429, error: "too_many_attempts", retryAfter: retryAfter(until, nowMs) } : f;
}
const NOT_FOUND: Fail = { ok: false, status: 404, error: "invalid_or_expired" };

/** 主畫面 App 發起：回傳代碼（放進 LINE 登入的 redirectTo）和領取密鑰（只留在 App 的 sessionStorage） */
export async function startPairing(request: Request, nowMs = Date.now()):
  Promise<{ ok: true; code: string; secret: string; expiresAt: string } | Fail> {
  const k = `pair-start:${clientIp(request)}`;
  const l = await locked(k, nowMs);
  if (l) return l;
  await recordFailure(k, START_LIMIT.max, START_LIMIT.windowSeconds, START_LIMIT.lockSeconds); // 每次發起都算一次，限制建立的數量
  await store.deleteExpired(new Date(nowMs).toISOString());
  const code = randomBytes(32).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(nowMs + PAIRING_TTL_MS).toISOString();
  await store.insertPairing(sha256(code), sha256(secret), expiresAt);
  return { ok: true, code, secret, expiresAt };
}

/**
 * Safari 登入完成後認領：userId 是 Safari 這次登入的人（路由已驗證 access token），
 * refreshToken 是 Safari 拿到的 refresh token；伺服器用它換一組新的憑證存起來（必須是同一個人）。
 * 認領成功後 Safari 那邊要丟掉自己的登入（不要呼叫 signOut），否則兩邊共用同一組會被 Supabase 當成重複使用而整組登出。
 */
export async function claimPairing(request: Request, userId: string, code: unknown, refreshToken: unknown, nowMs = Date.now()):
  Promise<{ ok: true } | Fail> {
  const l = await locked(failKey(request), nowMs);
  if (l) return l;
  if (!isToken(code)) return fail(request, nowMs, NOT_FOUND);
  const codeHash = sha256(code);
  const row = await store.getPairing(codeHash);
  if (!row || row.status !== "pending" || Date.parse(row.expiresAt) <= nowMs) return fail(request, nowMs, NOT_FOUND);
  if (typeof refreshToken !== "string" || !refreshToken) return { ok: false, status: 400, error: "invalid_session" };
  const session = await store.refreshSession(refreshToken);
  if (!session || session.userId !== userId) return { ok: false, status: 400, error: "invalid_session" };
  const ok = await store.markReady(codeHash, userId, encrypt(session), new Date(nowMs).toISOString());
  return ok ? { ok: true } : NOT_FOUND;
}

/** 主畫面 App 輪詢：還沒認領回 pending；認領了回登入憑證（只拿得到一次） */
export async function pollPairing(request: Request, code: unknown, secret: unknown, nowMs = Date.now()):
  Promise<{ ok: true; status: "pending"; expiresAt: string } | { ok: true; status: "ready"; session: store.PairingSession } | Fail> {
  const l = await locked(failKey(request), nowMs);
  if (l) return l;
  if (!isToken(code) || !isToken(secret)) return fail(request, nowMs, NOT_FOUND);
  const codeHash = sha256(code);
  const row = await store.getPairing(codeHash);
  if (!row || Date.parse(row.expiresAt) <= nowMs) {
    if (row) await store.deletePairing(codeHash);
    return fail(request, nowMs, NOT_FOUND);
  }
  const pollHash = sha256(secret);
  if (!timingSafeEqual(Buffer.from(pollHash), Buffer.from(row.pollHash))) {
    // 看到網址上的代碼、但沒有密鑰的人：記錯；同一筆錯太多次就作廢
    if ((await store.addPollFailure(codeHash)) >= MAX_POLL_FAILURES) await store.deletePairing(codeHash);
    return fail(request, nowMs, NOT_FOUND);
  }
  if (row.status === "pending") return { ok: true, status: "pending", expiresAt: row.expiresAt };
  const payload = await store.takeReady(codeHash, pollHash, new Date(nowMs).toISOString());
  if (!payload) return NOT_FOUND; // 同時兩個輪詢：只有一個拿得到
  return { ok: true, status: "ready", session: decrypt(payload) };
}

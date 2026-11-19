// 前端：大頭照失效自動換新（老闆 2026-11-19 乙案；審伯 2026-11-19 必修 1、3、4 後的版本）。伺服器見 app/api/auth/line-token、app/api/auth/refresh-picture。
// 這裡不碰任何金鑰：只把 Supabase 剛登入時給的 LINE refresh token 交給伺服器，由伺服器加密保存。
import type { Session } from "@supabase/supabase-js";

const SENT_KEY = "mj-line-token-sent";       // 伺服器確認收下的那個 token 的雜湊（只存雜湊）
const PENDING_KEY = "mj-line-token-pending"; // 伺服器還沒確認收下的 { uid, rt }：功能停用、伺服器錯誤時留著，下次載入頁面補存（必修 3）

/** 登出刪授權失敗時，隔多久重試（毫秒）；測試會換掉 */
export const revokeRetry = { delaysMs: [1000, 3000, 10000] };

async function digest(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function readPending(): { uid: string; rt: string } | null {
  try {
    const p = JSON.parse(storage()?.getItem(PENDING_KEY) ?? "null") as { uid?: unknown; rt?: unknown } | null;
    return p && typeof p.uid === "string" && typeof p.rt === "string" ? { uid: p.uid, rt: p.rt } : null;
  } catch {
    return null;
  }
}

/**
 * 剛用 LINE 登入：Supabase 的 session 會帶 provider_refresh_token（只有登入後第一個 session 有，之後換 token 就沒了），交給伺服器存。
 * 伺服器回 { ok: true } 才算存好（記雜湊、不再送）；回 ok:false（功能停用）、伺服器錯誤、網路錯誤都先留在本機，
 * 之後同一個人載入頁面時就算 session 已經換過也會補存（必修 3）。換了別人登入不送前一個人的。遊客不送。在背景跑，不擋登入
 */
export async function rememberLineToken(session: Session | null): Promise<void> {
  if (!session || (session.user?.app_metadata as Record<string, unknown> | undefined)?.guest === true) return;
  const uid = session.user?.id;
  if (!uid) return;
  let rt = session.provider_refresh_token ?? null;
  if (rt) {
    const p = readPending();
    if (!p || p.uid !== uid || p.rt !== rt) storage()?.setItem(PENDING_KEY, JSON.stringify({ uid, rt }));
  } else {
    const p = readPending();
    if (!p || p.uid !== uid) return;
    rt = p.rt;
  }
  try {
    const tag = await digest(rt);
    if (storage()?.getItem(SENT_KEY) === tag) { storage()?.removeItem(PENDING_KEY); return; }
    const r = await fetch("/api/auth/line-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ refreshToken: rt }),
    });
    const body = (await r.json().catch(() => null)) as { ok?: unknown; reason?: unknown } | null;
    if (r.ok && body?.ok === true) {
      storage()?.setItem(SENT_KEY, tag);
      storage()?.removeItem(PENDING_KEY);
      onTokenSaved();
    } else if (body?.reason === "revoked" || body?.reason === "guest") {
      storage()?.removeItem(PENDING_KEY); // 不會成功的就不留
    }
  } catch {
    // 網路錯誤：留著，下次載入頁面再送
  }
}

/**
 * 登出：請伺服器刪掉這次登入存的授權（要在清掉本機登入之前拿好 headers）。失敗（伺服器錯誤、網路錯誤）會照 revokeRetry 重試，
 * 最多再試 3 次；本機的已送記號和待補存一律清掉（必修 1）。不等結果
 */
export function forgetLineToken(headers: Record<string, string>): void {
  storage()?.removeItem(SENT_KEY);
  storage()?.removeItem(PENDING_KEY);
  if (!headers.Authorization) return;
  void (async () => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch("/api/auth/line-token", { method: "DELETE", headers, keepalive: true });
        if (r.ok) return;
      } catch {
        // 網路錯誤：重試
      }
      if (i >= revokeRetry.delaysMs.length) return;
      await new Promise((res) => setTimeout(res, revokeRetry.delaysMs[i]));
    }
  })();
}

// ---- 自己的頭像載不出來：跟伺服器要新照片（每頁一次；伺服器另有 10 分鐘冷卻）----
let refreshState: "idle" | "done" | "waiting" = "idle"; // waiting＝伺服器說還沒存授權，等存好再試（必修 4）
let waiters: ((url: string) => void)[] = [];
let waitingHeaders: (() => Promise<Record<string, string>>) | null = null;
let saveSeq = 0; // 授權存好幾次了：換照請求送出後、回來前有存好（回應交錯），回來的 no_token 就是過時的（審伯 2026-11-19 複審建議）

/**
 * 請伺服器跟 LINE 換新照片。拿到 https 網址回傳，沒拿到回 null（畫面照舊顯示名字第一個字）。
 * 伺服器回 no_token（授權還沒存好）不算用掉這一頁的那一次，兩種回應順序都只再試一次：
 *   ・先回 no_token、授權後來才存好 → 存好時自動再換一次，換到的新網址交給 onLater
 *   ・授權先存好、這個請求才回 no_token（送出時還沒存好）→ 馬上再換一次（isRetry：重試的那一次不會再重試）
 */
export async function refreshMyPicture(authHeaders: () => Promise<Record<string, string>>, onLater?: (url: string) => void, isRetry = false): Promise<string | null> {
  if (refreshState === "waiting") { if (onLater) waiters.push(onLater); return null; }
  if (refreshState === "done") return null;
  refreshState = "done";
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return null;
    const seqAtSend = saveSeq;
    const r = await fetch("/api/auth/refresh-picture", { method: "POST", headers });
    const body = (await r.json().catch(() => null)) as { pictureUrl?: unknown; reason?: unknown } | null;
    if (body?.reason === "no_token" && saveSeq !== seqAtSend && !isRetry) {
      refreshState = "idle"; // 回應交錯：授權在這個請求送出後已經存好，這個 no_token 是過時的，馬上再換一次
      return refreshMyPicture(authHeaders, onLater, true);
    }
    if (body?.reason === "no_token") {
      if (isRetry) return null; // 已經重試過一次，不再等
      refreshState = "waiting";
      waitingHeaders = authHeaders;
      if (onLater) waiters.push(onLater);
      return null;
    }
    return r.ok && typeof body?.pictureUrl === "string" && body.pictureUrl.startsWith("https://") ? body.pictureUrl : null;
  } catch {
    return null;
  }
}

/** 授權剛存好：之前因為 no_token 在等的頭像，現在再換一次（就是那唯一的一次重試）；請求還在路上的，回來時會看到 saveSeq 變了 */
function onTokenSaved(): void {
  saveSeq++;
  if (refreshState !== "waiting" || !waitingHeaders) return;
  const ws = waiters, headers = waitingHeaders;
  refreshState = "idle"; waiters = []; waitingHeaders = null;
  void refreshMyPicture(headers, undefined, true).then((url) => { if (url) ws.forEach((w) => w(url)); });
}

/** 測試用：重設「這頁已經問過」 */
export function resetRefreshTried(): void {
  refreshState = "idle"; waiters = []; waitingHeaders = null;
}

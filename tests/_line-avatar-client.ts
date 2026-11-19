// 前端：大頭照失效自動換新（老闆 2026-11-19 乙案）lib/linePicture/client.ts
//   C1 剛 LINE 登入（session 有 provider_refresh_token）：送一次給伺服器（帶登入 token）；同一個 token 不重送；換了新 token 才再送
//   C2 沒有 provider_refresh_token、遊客：不送
//   C3 伺服器回錯：不記成已送，下次再送；本機只存 token 的雜湊，不存 token 本身
//   C4 登出：送 DELETE（帶登入 token、keepalive），清掉已送記號；沒有登入 token 就不送
//   C5 自己的頭像載不出來：一頁只問一次；拿到 https 網址才回傳，其他回 null
//   C6 useMjAuth 有接上：初次讀到 session、SIGNED_IN 時交出授權；登出時先刪授權、才清本機登入；右上自己的頭像會換新
// 審伯 2026-11-19 必修：
//   C7 功能停用（伺服器回 200 但 ok:false、disabled）不當成已保存；之後開啟，就算 session 已經換過、沒有 provider_refresh_token，
//      同一個人下次載入頁面也會補存；補存成功才清掉；換了別人登入不會送前一個人的授權；登出清掉待補存的授權
//   C8 授權還沒存好、頭像就先載不出來（伺服器回 no_token）：不算用掉這一頁的那一次；授權存好之後自動再換一次，新照片交給頭像
//   C9 登出刪授權失敗（伺服器 500、網路錯誤）會重試，最多 3 次；成功就停
//   C10 回應交錯（審伯 2026-11-19 複審建議）：換照請求先送出、還沒回來時授權已經存好，換照請求才回 no_token
//       → 也要再換一次、把新照片交給頭像；兩種順序（先 no_token 後存好、先存好後 no_token）都只重試一次
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "@supabase/supabase-js";
import { forgetLineToken, refreshMyPicture, rememberLineToken, resetRefreshTried, revokeRetry } from "../lib/linePicture/client";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = { localStorage: {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
} };
const calls: { url: string; method: string; auth: string | null; body: unknown; keepalive?: boolean }[] = [];
let status = 200, reply: unknown = { ok: true };
let script: { status: number; body: unknown }[] = []; // 有排就照順序回，沒排就回 status／reply
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const h = new Headers(init?.headers);
  calls.push({ url, method: init?.method ?? "GET", auth: h.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null, ...(init?.keepalive ? { keepalive: true } : {}) });
  const next = script.shift();
  if (next && next.status === 0) throw new TypeError("network");
  return new Response(JSON.stringify(next ? next.body : reply), { status: next ? next.status : status });
}) as typeof fetch;
const sess = (rt: string | null, guest = false, uid = "u-1") => ({ access_token: "at-1", provider_refresh_token: rt, user: { id: uid, app_metadata: guest ? { guest: true } : {} } }) as unknown as Session;
revokeRetry.delaysMs = [0, 0, 0];

// C1
await rememberLineToken(sess("rt-1"));
await rememberLineToken(sess("rt-1"));
await rememberLineToken(sess("rt-2"));
eq(calls.map((c) => [c.url, c.method, c.auth, c.body]), [["/api/auth/line-token", "POST", "Bearer at-1", { refreshToken: "rt-1" }], ["/api/auth/line-token", "POST", "Bearer at-1", { refreshToken: "rt-2" }]],
  "C1 剛 LINE 登入：送一次（帶登入 token）；同一個 token 不重送，新 token 才再送");
// C2
calls.length = 0;
await rememberLineToken(sess(null));
await rememberLineToken(null);
await rememberLineToken(sess("rt-guest", true));
eq(calls.length, 0, "C2 沒有 provider_refresh_token、沒有 session、遊客：都不送");
// C3
calls.length = 0; status = 500;
await rememberLineToken(sess("rt-3"));
status = 200;
await rememberLineToken(sess("rt-3"));
eq([calls.length, [...store.values()].some((v) => v.includes("rt-3")), [...store.values()][0]?.length], [2, false, 32], "C3 伺服器回錯不記成已送、下次再送；送成功後本機只留雜湊（32 字），待補存的 token 清掉");
// C4
calls.length = 0;
forgetLineToken({ Authorization: "Bearer at-1" });
forgetLineToken({});
await new Promise((r) => setTimeout(r, 0));
eq([calls.map((c) => [c.url, c.method, c.auth, c.keepalive]), store.size], [[["/api/auth/line-token", "DELETE", "Bearer at-1", true]], 0], "C4 登出送 DELETE（帶登入 token、keepalive）並清掉記號；沒有登入 token 不送");
// C5
calls.length = 0; reply = { pictureUrl: "https://profile.line-scdn.net/new", updated: true };
const headers = async () => ({ Authorization: "Bearer at-1" });
const r1 = await refreshMyPicture(headers);
const r2 = await refreshMyPicture(headers);
resetRefreshTried(); reply = { pictureUrl: "http://evil/x" };
const r3 = await refreshMyPicture(headers);
resetRefreshTried(); reply = { pictureUrl: null, reason: "cooldown" };
const r4 = await refreshMyPicture(headers);
eq([r1, r2, r3, r4, calls.length, calls[0]?.url], ["https://profile.line-scdn.net/new", null, null, null, 3, "/api/auth/refresh-picture"],
  "C5 一頁只問一次；拿到 https 網址才回傳，非 https 或沒換到回 null");
// C6
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(path.join(ROOT, "hooks/useMjAuth.ts"), "utf8");
const lobby = readFileSync(path.join(ROOT, "components/mahjong/MjLobbyAuth.tsx"), "utf8");
const signOutBody = hook.slice(hook.indexOf("const signOut = useCallback"));
eq([/rememberLineToken\(data\.session\)/.test(hook), /event === "SIGNED_IN"\) void rememberLineToken\(session\)/.test(hook),
  signOutBody.indexOf("forgetLineToken(") > 0 && signOutBody.indexOf("forgetLineToken(") < signOutBody.indexOf("auth.signOut("), /<Avatar user=\{user\} self \/>/.test(lobby)],
  [true, true, true, true], "C6 useMjAuth 初次讀 session、SIGNED_IN 時交出授權；登出時先刪授權再清本機登入；右上自己的頭像會換新");

// C7
{
  store.clear(); calls.length = 0; script = [];
  reply = { ok: false, reason: "disabled" };
  await rememberLineToken(sess("rt-c7"));
  const markedAfterDisabled = [...store.keys()].some((k) => k.includes("sent") && store.get(k));
  reply = { ok: true };
  await rememberLineToken(sess(null, false, "u-other"));   // 換別人登入：不送 u-1 的授權
  const sentForOther = calls.length;
  await rememberLineToken(sess(null));                     // 同一個人、session 已換過（沒有 provider_refresh_token）：補存
  const resent = calls.slice(1).map((c) => c.body);
  await rememberLineToken(sess(null));                     // 補存成功後不再送
  const pendingLeft = [...store.keys()].filter((k) => k.includes("pending")).length;
  reply = { ok: false, reason: "disabled" };
  await rememberLineToken(sess("rt-c7b"));
  forgetLineToken({ Authorization: "Bearer at-1" });       // 登出：待補存的一起清掉
  await new Promise((r) => setTimeout(r, 0));
  const pendingAfterLogout = [...store.keys()].filter((k) => k.includes("pending")).length;
  eq([markedAfterDisabled, sentForOther, resent, calls.length, pendingLeft, pendingAfterLogout], [false, 1, [{ refreshToken: "rt-c7" }], 4, 0, 0],
    "C7 停用（ok:false）不當成已保存；開啟後同一個人就算 session 換過也會補存一次；別人登入不送；登出清掉待補存");
}
// C8
{
  store.clear(); calls.length = 0; script = []; resetRefreshTried();
  reply = { pictureUrl: null, updated: false, reason: "no_token" };
  const later: string[] = [];
  const headers = async () => ({ Authorization: "Bearer at-1" });
  const first = await refreshMyPicture(headers, (url) => later.push(url));
  script = [{ status: 200, body: { ok: true } }, { status: 200, body: { pictureUrl: "https://profile.line-scdn.net/c8", updated: true } }];
  await rememberLineToken(sess("rt-c8"));                  // 授權存好 → 自動再換一次
  await new Promise((r) => setTimeout(r, 0));
  const again = await refreshMyPicture(headers);           // 已經換過，這一頁不會再問
  eq([first, later, calls.map((c) => c.url), again], [null, ["https://profile.line-scdn.net/c8"],
    ["/api/auth/refresh-picture", "/api/auth/line-token", "/api/auth/refresh-picture"], null],
    "C8 先回 no_token 不算用掉；授權存好後自動再換一次，新照片交給頭像；之後這一頁不再問");
}
// C9
{
  calls.length = 0;
  script = [{ status: 500, body: {} }, { status: 0, body: null }, { status: 200, body: { ok: true } }];
  forgetLineToken({ Authorization: "Bearer at-1" });
  await new Promise((r) => setTimeout(r, 20));
  const n1 = calls.filter((c) => c.method === "DELETE").length;
  calls.length = 0; script = [{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }];
  forgetLineToken({ Authorization: "Bearer at-1" });
  await new Promise((r) => setTimeout(r, 20));
  eq([n1, calls.filter((c) => c.method === "DELETE").length], [3, 4], "C9 登出刪授權失敗（500、網路錯誤）會重試，成功就停；一直失敗最多重試 3 次（共 4 次）");
}

// C10
{
  const realFetch = globalThis.fetch;
  const run = async (order: "noTokenFirst" | "savedFirst", retryReply: unknown) => {
    resetRefreshTried(); store.clear();
    const log: string[] = [];
    let releaseRefresh: (() => void) | null = null;
    let refreshCount = 0;
    globalThis.fetch = (async (url: string) => {
      log.push(url);
      if (url === "/api/auth/line-token") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      refreshCount++;
      if (refreshCount === 1) {
        if (order === "savedFirst") await new Promise<void>((r) => { releaseRefresh = r; }); // 第一個換照請求卡住，等授權存好才回
        return new Response(JSON.stringify({ pictureUrl: null, updated: false, reason: "no_token" }), { status: 200 });
      }
      return new Response(JSON.stringify(retryReply), { status: 200 });
    }) as typeof fetch;
    const later: string[] = [];
    const headers = async () => ({ Authorization: "Bearer at-1" });
    let first: string | null;
    if (order === "noTokenFirst") {
      first = await refreshMyPicture(headers, (u) => later.push(u));
      await rememberLineToken(sess(`rt-${order}`));
    } else {
      const p = refreshMyPicture(headers, (u) => later.push(u));
      await new Promise((r) => setTimeout(r, 0));
      await rememberLineToken(sess(`rt-${order}`));               // 授權先存好
      (releaseRefresh as (() => void) | null)?.();                 // 換照請求才回 no_token
      first = await p;
    }
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    return { got: [first, ...later].filter(Boolean), refreshCalls: log.filter((u) => u === "/api/auth/refresh-picture").length };
  };
  const ok = { pictureUrl: "https://profile.line-scdn.net/c10", updated: true };
  const stillNo = { pictureUrl: null, updated: false, reason: "no_token" };
  const a = await run("noTokenFirst", ok), b = await run("savedFirst", ok);
  const a2 = await run("noTokenFirst", stillNo), b2 = await run("savedFirst", stillNo);
  globalThis.fetch = realFetch;
  eq([a, b, a2.refreshCalls, b2.refreshCalls],
    [{ got: ["https://profile.line-scdn.net/c10"], refreshCalls: 2 }, { got: ["https://profile.line-scdn.net/c10"], refreshCalls: 2 }, 2, 2],
    "C10 兩種回應順序（先 no_token 後存好、先存好後 no_token）都會再換一次、新照片交給頭像；重試還是 no_token 也只重試一次");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

// 大頭照失效自動換新（老闆 2026-11-19 乙案）：登入時把 LINE 的 refresh token 加密存起來，照片網址失效時用它跟 LINE 換新照片。
// 資料庫是 PGlite 跑真的 20261119_line_tokens.sql；路由、加密、資料存取都是真程式碼；LINE 和 Supabase Auth 管理 API 在 fetch 這一層攔截。
//   A1 沒登入：存授權、刪授權、換照片三支 API 都回 401
//   A2 存授權：資料庫裡是加密後的內容，查表看不到明文；密文綁帳號，換到別的帳號解不開
//   A3 權限：line_tokens 開了 RLS，anon／authenticated 讀不到、也不能執行三個函式；只有 service_role 可以
//   A4 換照片成功：LINE 給新網址 → 寫回帳號 user_metadata.picture（其他欄位保留），回傳新網址；LINE 換發新的 refresh token 就換存
//   A5 照片沒變：不寫帳號
//   A6 LINE 回錯（換授權失敗、拿個資失敗）、授權失效：不清舊照片、不寫帳號；授權失效（invalid_grant）就刪掉那筆授權
//   A7 冷卻：成功或失敗後 10 分鐘內再呼叫，不會再打 LINE；過了冷卻才會再打
//   A8 只能更新自己：body 帶別人的帳號 id 也只動自己的；LINE 帳號跟登入的不是同一個人，不更新
//   A9 登出：刪授權後資料庫沒有這個人的資料，之後換照片回 no_token、不打 LINE
//   A10 遊客、沒設定加密金鑰：不存、不換，回 200（不擋登入）
//   A11 migration 回滾後表和函式都不見；再套一次可以正常用
// 審伯 2026-11-19 必修（重現他描述的情境）：
//   B1 登出撤銷：①換照片途中登出，LINE 換發的新授權不會被寫回 ②登出前送出、登出後才到的保存請求不會存進去
//      ③重新登入（新的 session）可以存新授權 ④舊 session 晚到的刪除不會刪掉新授權 ⑤舊的換照請求跨過重新登入，
//      不會覆寫新授權；LINE 說舊授權失效時也不會刪到新授權
//   B2 冷卻不能繞過：換照成功後 10 分鐘內，連續三次「刪除、重新登入保存、換照」都不會再打 LINE；同時打兩次只打一次
//   B3 功能停用時保存回 ok:false（前端不會當成已保存，見 _line-avatar-client.ts C7）；開啟後同一個授權可以補存
//   B4 授權還沒存就先換照片（no_token）不會吃掉冷卻：存好之後馬上可以換
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_SETUP } from "../support/pg-mj";
import { installPostgrest } from "../support/thirteen-postgrest";
import { tokens } from "../support/stub-auth";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const BASE = "http://line-avatar.test";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LINE_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LINE_CHANNEL_ID = "1234567890";
process.env.LINE_CHANNEL_SECRET = "line-secret";

const db = new PGlite();
await db.exec(SUPABASE_SETUP);
await db.exec(readFileSync(path.join(MIG, "20261119_line_tokens.sql"), "utf8"));
installPostgrest(db, BASE);

// 帳號：A、B 是 LINE 玩家，G 是遊客
const A = "00000000-0000-4000-8000-00000000aa01", B = "00000000-0000-4000-8000-00000000aa02", G = "00000000-0000-4000-8000-00000000aa03";
for (const id of [A, B, G]) await db.query(`insert into auth.users (id) values ($1)`, [id]);
tokens["tk-a"] = { id: A, displayName: "阿", pictureUrl: "https://profile.line-scdn.net/old-a", isGuest: false };
tokens["tk-b"] = { id: B, displayName: "貝", pictureUrl: "https://profile.line-scdn.net/old-b", isGuest: false };
tokens["tk-g"] = { id: G, displayName: "客", pictureUrl: null, isGuest: true };
// Supabase Auth 管理 API 的帳號資料（user_metadata）
const meta: Record<string, Record<string, unknown>> = {
  [A]: { name: "阿", sub: "Uaaa", picture: "https://profile.line-scdn.net/old-a", email_verified: true },
  [B]: { name: "貝", sub: "Ubbb", picture: "https://profile.line-scdn.net/old-b" },
};
const adminWrites: { id: string; body: unknown }[] = [];
// LINE：refresh token → 行為
type LineScript = { refresh?: "ok" | "invalid_grant" | "500"; newRefresh?: string; userId?: string; picture?: string | null; profile?: "ok" | "500" };
const line: Record<string, LineScript> = {};
const lineCalls: string[] = [];
let onLineToken: (() => Promise<void>) | null = null; // 換授權的 LINE 呼叫回應前插入的動作（模擬「換照片途中登出」）
const access: Record<string, string> = {}; // access token → 對應的 refresh token
const pgFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.href === "https://api.line.me/oauth2/v2.1/token") {
    const form = new URLSearchParams(String(init?.body));
    const rt = form.get("refresh_token") ?? "";
    lineCalls.push(`token:${rt}`);
    if (onLineToken) { const f = onLineToken; onLineToken = null; await f(); }
    const s = line[rt];
    if (form.get("grant_type") !== "refresh_token" || form.get("client_id") !== "1234567890" || form.get("client_secret") !== "line-secret") return json({ error: "invalid_client" }, 400);
    if (!s || s.refresh === "invalid_grant") return json({ error: "invalid_grant" }, 400);
    if (s.refresh === "500") return json({ error: "server" }, 500);
    const at = `at-${rt}`;
    access[at] = rt;
    return json({ access_token: at, token_type: "Bearer", expires_in: 2592000, ...(s.newRefresh ? { refresh_token: s.newRefresh } : {}) });
  }
  if (url.href === "https://api.line.me/v2/profile") {
    const at = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    lineCalls.push(`profile:${access[at] ?? "?"}`);
    const s = line[access[at]];
    if (!s || s.profile === "500") return json({ message: "error" }, 500);
    return json({ userId: s.userId, displayName: "x", ...(s.picture ? { pictureUrl: s.picture } : {}) });
  }
  const m = url.href.match(/^http:\/\/line-avatar\.test\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
  if (m) {
    const id = m[1];
    if ((init?.method ?? "GET").toUpperCase() === "PUT") {
      const body = JSON.parse(String(init?.body));
      adminWrites.push({ id, body });
      meta[id] = { ...meta[id], ...(body.user_metadata ?? {}) };
    }
    return json({ id, aud: "authenticated", app_metadata: {}, user_metadata: meta[id] ?? {}, created_at: "2026-11-01T00:00:00Z" });
  }
  return pgFetch(input, init);
}) as typeof fetch;

const { POST: saveRoute, DELETE: deleteRoute } = await import("../../app/api/auth/line-token/route");
const { POST: refreshRoute } = await import("../../app/api/auth/refresh-picture/route");
const { openToken } = await import("../../lib/linePicture/crypto");
const { lineClock } = await import("../../lib/linePicture/store");
let NOW = Date.parse("2026-11-19T12:00:00Z");
lineClock.now = () => NOW;

async function call(fn: (r: Request) => Promise<Response>, as: string | null, body?: object, method = "POST") {
  const r = await fn(new Request("http://x/", { method, headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer ${as}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { status: r.status, body: await r.json() };
}
const rows = async () => (await db.query<{ user_id: string; sealed: string }>(`select user_id, sealed from line_tokens order by user_id`)).rows;
const sealedOf = async (id: string) => (await rows()).find((r) => r.user_id === id)?.sealed ?? null;

// A1
eq([(await call(saveRoute, null, { refreshToken: "rt-a1" })).status, (await call(deleteRoute, null, undefined, "DELETE")).status, (await call(refreshRoute, null)).status],
  [401, 401, 401], "A1 沒登入：存授權、刪授權、換照片都回 401");

// A2
{
  const r = await call(saveRoute, "tk-a", { refreshToken: "rt-a1-secret-plain" });
  const all = (await db.query<{ t: string }>(`select line_tokens::text t from line_tokens`)).rows.map((x) => x.t).join("\n");
  const sealed = await sealedOf(A);
  let other: string | null = "沒有丟錯";
  try { other = openToken(sealed!, B); } catch { other = null; }
  eq([r.status, r.body, (await rows()).length, all.includes("rt-a1-secret-plain"), sealed?.startsWith("v1."), openToken(sealed!, A), other],
    [200, { ok: true }, 1, false, true, "rt-a1-secret-plain", null],
    "A2 存授權：資料庫裡查不到明文（只有 v1. 開頭的密文），用本人帳號解得開，換成別的帳號解不開");
}

// A3
{
  const can = async (role: string, sqlText: string) => { try { await db.exec(`set role ${role}`); await db.exec(sqlText); return true; } catch { return false; } finally { await db.exec("reset role"); } };
  const sel = "select * from line_tokens", fn = `select line_token_claim('${A}', 1)`;
  const rls = (await db.query<{ r: boolean }>(`select bool_and(relrowsecurity) r from pg_class where relname in ('line_tokens', 'line_refresh_state')`)).rows[0].r;
  const st = "select * from line_refresh_state";
  eq([rls, await can("anon", sel), await can("authenticated", sel), await can("anon", st), await can("authenticated", st), await can("anon", fn), await can("authenticated", fn), await can("service_role", sel), await can("service_role", st)],
    [true, false, false, false, false, false, false, true, true], "A3 line_tokens、line_refresh_state 都開了 RLS；anon、authenticated 不能讀兩張表、不能執行函式；service_role 可以");
}

// A4
line["rt-a1-secret-plain"] = { refresh: "ok", newRefresh: "rt-a2-rotated", userId: "Uaaa", picture: "https://profile.line-scdn.net/new-a" };
line["rt-a2-rotated"] = { refresh: "ok", userId: "Uaaa", picture: "https://profile.line-scdn.net/new-a" };
{
  const r = await call(refreshRoute, "tk-a");
  eq([r.status, r.body, adminWrites.length, adminWrites[0]?.id, meta[A], openToken((await sealedOf(A))!, A), lineCalls],
    [200, { pictureUrl: "https://profile.line-scdn.net/new-a", updated: true }, 1, A,
      { name: "阿", sub: "Uaaa", picture: "https://profile.line-scdn.net/new-a", email_verified: true }, "rt-a2-rotated",
      ["token:rt-a1-secret-plain", "profile:rt-a1-secret-plain"]],
    "A4 換照片成功：寫回帳號的 picture（name、sub 等其他欄位保留），回傳新網址；LINE 換發的新 refresh token 加密後換存");
}

// A5、A7（冷卻）
{
  const before = lineCalls.length;
  NOW += 5 * 60_000; // 5 分鐘後：還在冷卻
  const cool = await call(refreshRoute, "tk-a");
  const callsInCooldown = lineCalls.length - before;
  NOW += 6 * 60_000; // 再 6 分鐘（共 11 分鐘）：冷卻過了
  tokens["tk-a"] = { ...tokens["tk-a"], pictureUrl: "https://profile.line-scdn.net/new-a" };
  const same = await call(refreshRoute, "tk-a");
  eq([cool.body, callsInCooldown, same.body, lineCalls.length - before, adminWrites.length],
    [{ pictureUrl: null, updated: false, reason: "cooldown" }, 0, { pictureUrl: "https://profile.line-scdn.net/new-a", updated: false }, 2, 1],
    "A7 冷卻 10 分鐘內再呼叫不打 LINE（回 cooldown）；A5 過了冷卻再換一次，照片沒變就不寫帳號");
}

// A6
{
  await call(saveRoute, "tk-b", { refreshToken: "rt-b-500" });
  line["rt-b-500"] = { refresh: "500" };
  const e1 = await call(refreshRoute, "tk-b");
  NOW += 11 * 60_000;
  line["rt-b-500"] = { refresh: "ok", profile: "500", userId: "Ubbb" };
  const e2 = await call(refreshRoute, "tk-b");
  NOW += 11 * 60_000;
  line["rt-b-500"] = { refresh: "invalid_grant" };
  const e3 = await call(refreshRoute, "tk-b");
  eq([e1.status, e1.body, e2.body, e3.body, meta[B].picture, adminWrites.filter((w) => w.id === B).length, await sealedOf(B)],
    [200, { pictureUrl: null, updated: false, reason: "line_error" }, { pictureUrl: null, updated: false, reason: "line_error" },
      { pictureUrl: null, updated: false, reason: "token_invalid" }, "https://profile.line-scdn.net/old-b", 0, null],
    "A6 LINE 換授權失敗、拿個資失敗：回 200 不擋、不清舊照片、不寫帳號；授權失效（invalid_grant）就刪掉那筆授權");
}

// A8
{
  await call(saveRoute, "tk-b", { refreshToken: "rt-b-other-line" });
  line["rt-b-other-line"] = { refresh: "ok", userId: "Uaaa", picture: "https://profile.line-scdn.net/evil" }; // 存的是別人的 LINE 授權
  NOW += 11 * 60_000;
  const mismatch = await call(refreshRoute, "tk-b", { userId: A });
  await call(saveRoute, "tk-b", { refreshToken: "rt-b-ok", userId: A });
  line["rt-b-ok"] = { refresh: "ok", userId: "Ubbb", picture: "https://profile.line-scdn.net/new-b" };
  NOW += 11 * 60_000;
  const ok = await call(refreshRoute, "tk-b", { userId: A });
  eq([mismatch.body, ok.body, meta[A].picture, meta[B].picture, openToken((await sealedOf(A))!, A)],
    [{ pictureUrl: null, updated: false, reason: "mismatch" }, { pictureUrl: "https://profile.line-scdn.net/new-b", updated: true },
      "https://profile.line-scdn.net/new-a", "https://profile.line-scdn.net/new-b", "rt-a2-rotated"],
    "A8 只能更新自己：body 帶別人的 userId 也只動自己；存的 LINE 授權不是本人的（LINE userId 和帳號 sub 不同）就不更新");
}

// A9
{
  const d = await call(deleteRoute, "tk-a", undefined, "DELETE");
  const before = lineCalls.length;
  NOW += 11 * 60_000;
  const r = await call(refreshRoute, "tk-a");
  eq([d.status, d.body, await sealedOf(A), r.body, lineCalls.length - before],
    [200, { ok: true }, null, { pictureUrl: null, updated: false, reason: "no_token" }, 0], "A9 登出刪授權：資料庫沒有這個人的資料，之後換照片回 no_token、不打 LINE");
}

// A10
{
  const g1 = await call(saveRoute, "tk-g", { refreshToken: "rt-guest" });
  const g2 = await call(refreshRoute, "tk-g");
  const bad = await Promise.all([{}, { refreshToken: "" }, { refreshToken: 123 }, { refreshToken: "x".repeat(5000) }].map((b) => call(saveRoute, "tk-a", b)));
  const key = process.env.LINE_TOKEN_KEY;
  delete process.env.LINE_TOKEN_KEY;
  const off1 = await call(saveRoute, "tk-a", { refreshToken: "rt-off" });
  NOW += 11 * 60_000;
  const off2 = await call(refreshRoute, "tk-b");
  process.env.LINE_TOKEN_KEY = key;
  eq([g1.status, g1.body, g2.body, bad.map((x) => [x.status, x.body.error]), off1.body, off2.body, await sealedOf(G), await sealedOf(A)],
    [200, { ok: false, reason: "guest" }, { pictureUrl: null, updated: false, reason: "guest" }, [[400, "bad_request"], [400, "bad_request"], [400, "bad_request"], [400, "bad_request"]],
      { ok: false, reason: "disabled" }, { pictureUrl: null, updated: false, reason: "disabled" }, null, null],
    "A10 遊客不存不換、格式不對回 400；沒設定加密金鑰時不存不換、回 200（不擋登入）");
}

// B1 登出撤銷
tokens["tk-a-s1"] = { ...tokens["tk-a"] }; // A 這次登入（tk-a 在 A9 已經登出過）
tokens["tk-a-s2"] = { ...tokens["tk-a"] }; // A 重新登入後的新 session
tokens["tk-a-s3"] = { ...tokens["tk-a"] };
{
  NOW += 60 * 60_000;
  await call(saveRoute, "tk-a-s1", { refreshToken: "rt-b1-a" });
  line["rt-b1-a"] = { refresh: "ok", newRefresh: "rt-b1-rotated", userId: "Uaaa", picture: "https://profile.line-scdn.net/new-a" };
  onLineToken = async () => { await call(deleteRoute, "tk-a-s1", undefined, "DELETE"); }; // 換照片打到 LINE 的時候，玩家按了登出
  await call(refreshRoute, "tk-a-s1");
  const afterLogout = await sealedOf(A);
  const lateSave = await call(saveRoute, "tk-a-s1", { refreshToken: "rt-b1-late" }); // 登出前送出、登出後才到
  const afterLate = await sealedOf(A);
  const relogin = await call(saveRoute, "tk-a-s2", { refreshToken: "rt-b1-new" });
  const oldDelete = await call(deleteRoute, "tk-a-s1", undefined, "DELETE"); // 舊 session 晚到的刪除
  const afterOldDelete = await sealedOf(A);
  // 舊換照請求跨過重新登入：換照片打到 LINE 時，玩家登出又用新 session 登入存了新授權
  NOW += 11 * 60_000;
  line["rt-b1-new"] = { refresh: "ok", newRefresh: "rt-b1-new-rotated", userId: "Uaaa", picture: "https://profile.line-scdn.net/new-a" };
  onLineToken = async () => { await call(deleteRoute, "tk-a-s2", undefined, "DELETE"); await call(saveRoute, "tk-a-s3", { refreshToken: "rt-b1-third" }); };
  await call(refreshRoute, "tk-a-s2");
  const afterCross = await sealedOf(A);
  NOW += 11 * 60_000;
  // 舊授權失效：換照片途中重新登入，LINE 回 invalid_grant，也不能刪到新存的授權
  line["rt-b1-third"] = { refresh: "invalid_grant" };
  onLineToken = async () => { await call(saveRoute, "tk-a-s3", { refreshToken: "rt-b1-fourth" }); };
  await call(refreshRoute, "tk-a-s3");
  const afterInvalid = await sealedOf(A);
  eq([afterLogout, lateSave.body, afterLate, relogin.body, afterOldDelete && openToken(afterOldDelete, A), afterCross && openToken(afterCross, A), afterInvalid && openToken(afterInvalid, A)],
    [null, { ok: false, reason: "revoked" }, null, { ok: true }, "rt-b1-new", "rt-b1-third", "rt-b1-fourth"],
    "B1 登出撤銷：換照途中登出不寫回、登出後才到的保存不存、新 session 可以存、舊 session 的刪除不刪新授權、舊換照請求不覆寫也不刪新授權");
}

// B2 冷卻不能繞過
{
  NOW += 60 * 60_000;
  tokens["tk-b-s2"] = { ...tokens["tk-b"] }; tokens["tk-b-s3"] = { ...tokens["tk-b"] }; tokens["tk-b-s4"] = { ...tokens["tk-b"] };
  await call(saveRoute, "tk-b", { refreshToken: "rt-b2-0" });
  line["rt-b2-0"] = { refresh: "ok", userId: "Ubbb", picture: "https://profile.line-scdn.net/new-b" };
  const first = await call(refreshRoute, "tk-b");
  const before = lineCalls.length;
  const loops = [];
  for (const [i, [oldTk, newTk]] of [["tk-b", "tk-b-s2"], ["tk-b-s2", "tk-b-s3"], ["tk-b-s3", "tk-b-s4"]].entries()) {
    await call(deleteRoute, oldTk, undefined, "DELETE");
    await call(saveRoute, newTk, { refreshToken: `rt-b2-${i + 1}` });
    line[`rt-b2-${i + 1}`] = { refresh: "ok", userId: "Ubbb", picture: "https://profile.line-scdn.net/new-b" };
    loops.push((await call(refreshRoute, newTk)).body.reason);
  }
  const callsInCooldown = lineCalls.length - before;
  NOW += 11 * 60_000;
  const both = await Promise.all([call(refreshRoute, "tk-b-s4"), call(refreshRoute, "tk-b-s4")]);
  eq([first.status, loops, callsInCooldown, both.map((r) => r.body.reason ?? "ok").sort(), lineCalls.length - before],
    [200, ["cooldown", "cooldown", "cooldown"], 0, ["cooldown", "ok"], 2],
    "B2 冷卻不能繞過：換照後 10 分鐘內連續三次「刪除、重新登入保存、換照」都回 cooldown、0 次 LINE；冷卻過後同時打兩次只有一次打 LINE");
}

// B3 停用 → 開啟
{
  const key = process.env.LINE_TOKEN_KEY;
  delete process.env.LINE_TOKEN_KEY;
  tokens["tk-a-s5"] = { ...tokens["tk-a"] };
  await call(deleteRoute, "tk-a-s3", undefined, "DELETE");
  const off = await call(saveRoute, "tk-a-s5", { refreshToken: "rt-b3" });
  const offRow = await sealedOf(A);
  process.env.LINE_TOKEN_KEY = key;
  const on = await call(saveRoute, "tk-a-s5", { refreshToken: "rt-b3" });
  eq([off.body, offRow, on.body, openToken((await sealedOf(A))!, A)], [{ ok: false, reason: "disabled" }, null, { ok: true }, "rt-b3"],
    "B3 停用時保存回 ok:false、不存；開啟後同一個授權補存成功");
}

// B4 先換照（no_token），存好之後馬上可以換
{
  NOW += 60 * 60_000;
  tokens["tk-c"] = { id: G.replace("aa03", "aa04"), displayName: "西", pictureUrl: "https://profile.line-scdn.net/old-c", isGuest: false };
  const C = tokens["tk-c"].id;
  await db.query(`insert into auth.users (id) values ($1)`, [C]);
  meta[C] = { name: "西", sub: "Uccc", picture: "https://profile.line-scdn.net/old-c" };
  const early = await call(refreshRoute, "tk-c");
  await call(saveRoute, "tk-c", { refreshToken: "rt-b4" });
  line["rt-b4"] = { refresh: "ok", userId: "Uccc", picture: "https://profile.line-scdn.net/new-c" };
  const later = await call(refreshRoute, "tk-c");
  eq([early.body, later.body], [{ pictureUrl: null, updated: false, reason: "no_token" }, { pictureUrl: "https://profile.line-scdn.net/new-c", updated: true }],
    "B4 授權還沒存就先換照片回 no_token、不吃冷卻；存好之後馬上可以換（不用等 10 分鐘）");
}

// A11
{
  await db.exec(readFileSync(path.join(MIG, "20261119_line_tokens_rollback.sql"), "utf8"));
  const gone = (await db.query<{ t: string | null; f: number }>(`select coalesce(to_regclass('public.line_tokens')::text, to_regclass('public.line_refresh_state')::text, to_regclass('public.line_tokens_gen_seq')::text) t, (select count(*)::int from pg_proc where proname like 'line_token_%') f`)).rows[0];
  await db.exec(readFileSync(path.join(MIG, "20261119_line_tokens.sql"), "utf8"));
  const again = await call(saveRoute, "tk-a", { refreshToken: "rt-after-rollback" });
  eq([gone, again.body, openToken((await sealedOf(A))!, A)], [{ t: null, f: 0 }, { ok: true }, "rt-after-rollback"], "A11 回滾後兩張表、序號和五個函式都不見；再套一次可以正常存");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

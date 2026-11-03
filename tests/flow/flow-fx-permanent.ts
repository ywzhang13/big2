// 後台找玩家 1 個字、特效開通永久（老闆 2026-11-04；20261106_mahjong_fx_permanent.sql），走真的 API 和 migration（PGlite）
//   S1 單一中文字、單一英文字、emoji 名字都搜得到；空白、空字串、超過上限 400；一般玩家 403
//   P1 開通：6 列永久，回應沒有到期日；玩家 API 6 種都是 null；後台 active 也是 null 且目前選用不會被打回金色
//   P2 胡牌：永久的特效存進牌局（JSON 來回）照樣有效，幾年後也有效；parseFxExpiry 認得正式庫回傳的 'infinity'
//   P3 大廳後台入口：永久開通的玩家 isOwner=false，老闆 true
//   P4 收回：全部收回、回到只能預覽（金色）、紀錄都留著；再開通又是永久
//   M1 migration：有效的轉永久（新增 6 列、舊列保留、1 筆操作紀錄）；過期、收回、qa- 帳號（開通者／名稱／email）不轉；舊的有期限開通照舊到期；重跑不多寫
//   M2 回滾：永久全部收回（不刪）；轉永久的人靠舊開通繼續有效；上線後才開的人補有期限開通
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GET as playersGet } from "../../app/api/mahjong/admin/players/route";
import { GET as fxGet, POST as fxPost } from "../../app/api/mahjong/admin/fx/route";
import { POST as revokePost } from "../../app/api/mahjong/admin/fx/revoke/route";
import { GET as myGet, POST as mySet } from "../../app/api/mahjong/zimo-fx/route";
import { applyZimoFx, prefetchZimoFx } from "../../lib/mahjong/zimoFx/attach";
import { parseFxExpiry, zimoFxValid } from "../../lib/mahjong/zimoFx/rules";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const id = (n: number) => `ef000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const [A, B, E, X, Y, Z, Q, QN, QM, W] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
users[A] = { name: "瑋", avatarUrl: null }; users[B] = { name: "K", avatarUrl: null }; users[E] = { name: "🌿", avatarUrl: null };
for (const [u, n] of [[X, "轉永久"], [Y, "過期"], [Z, "收回"], [Q, "qa開通"], [QN, "qa-名稱"], [QM, "qa信箱"], [W, "新開"]]) users[u] = { name: n, avatarUrl: null };
for (const u of [BOSS, A, B, E, X, Y, Z, Q, QN, QM, W]) await addUser(u);
const d = await db();
const T = (s: string) => Date.parse(s + "+08:00");
const iso = (s: string) => new Date(T(s)).toISOString();
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => { const r = await fn(new Request("http://x" + url, { headers: auth(tok) })); return { status: r.status, body: await r.json() }; };
const post = async (fn: (r: Request) => Promise<Response>, body: object, tok?: string) => { const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const n = async (sql: string, args: unknown[] = []) => Number((await d.query<{ n: number }>(sql, args)).rows[0].n);
const permRows = (u: string) => n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null and expires_at = 'infinity'", [u]);
const allRows = (u: string) => n("select count(*)::int n from mj_fx_grants where user_id = $1", [u]);
const auditN = (u: string, action: string) => n("select count(*)::int n from mj_fx_audit where target_user_id = $1 and action = $2", [u, action]);
const SIX = { meteor: null, thunder: null, storm: null, frost: null, blackhole: null, sakura: null };
const q = (s: string) => get(playersGet, `/?q=${encodeURIComponent(s)}`, "boss");
clock.now = T("2026-11-04T12:00:00");

// ---- S1 搜尋 ----
const names = async (s: string) => (await q(s)).body.players.map((p: { name: string }) => p.name);
eq([await names("瑋"), await names("k"), await names("🌿"), await names(" 瑋 ")], [["張育瑋", "瑋"], ["K"], ["🌿"], ["張育瑋", "瑋"]],
  "S1 打 1 個字就搜得到：中文「瑋」（一個字的名字也找到）、英文 k（不分大小寫）、emoji 🌿；前後空白會去掉");
eq([(await q("   ")).status, (await q("")).status, (await q("x".repeat(41))).status, (await q("x".repeat(40))).status, (await get(playersGet, "/?q=瑋".replace("瑋", "%E7%91%8B"), "a")).status],
  [400, 400, 400, 200, 403], "S1 只有空白、空字串、超過 40 字 400（上限不變，剛好 40 字可以）；一般玩家 403");

// ---- P1 開通 ----
await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'golden', now())", [A]);
const g1 = await post(fxPost, { userId: A }, "boss");
const mine1 = (await get(myGet, "/", "a")).body;
const set1 = await post(mySet, { fx: "sakura" }, "a");
const admin1 = (await get(fxGet, `/?userId=${A}`, "boss")).body;
eq([g1.status, g1.body, await permRows(A), mine1.selected, mine1.available, set1.status, admin1.active, admin1.selected, admin1.permanent],
  [200, { granted: 6 }, 6, "golden", { golden: null, ...SIX }, 200, SIX, "sakura", false],
  "P1 開通：6 列永久、回應沒有到期日、不改原本的金色；玩家 6 種都是 null（永久）；選櫻花成功；後台 active 全是 null，目前選用是櫻花（不會被打回金色）");

// ---- P2 胡牌 ----
const st = { players: [{ userId: A }] } as unknown as MahjongGameState;
applyZimoFx(st, await prefetchZimoFx(st));
const round = JSON.parse(JSON.stringify(st)) as MahjongGameState;
eq([round.players[0].zimoFx, zimoFxValid(round.players[0].zimoFx ?? undefined, T("2036-01-01T00:00:00")), parseFxExpiry("infinity"), parseFxExpiry("2026-11-15T16:00:00+00:00") === Date.parse("2026-11-15T16:00:00Z")],
  [{ code: "sakura", until: null }, "sakura", Infinity, true], "P2 永久的特效存進牌局（JSON 來回）是 until null，十年後照樣有效；parseFxExpiry 認得 'infinity' 和一般時間");

// ---- P3 大廳入口 ----
eq([mine1.isOwner, (await get(myGet, "/", "boss")).body.isOwner], [false, true], "P3 永久開通的玩家 isOwner=false（大廳不會多出斗內後台入口），老闆 true");

// ---- P4 收回 ----
const rv = await post(revokePost, { userId: A }, "boss");
const mine2 = (await get(myGet, "/", "a")).body;
const deny = await post(mySet, { fx: "storm" }, "a");
const admin2 = (await get(fxGet, `/?userId=${A}`, "boss")).body;
const st2 = { players: [{ userId: A }] } as unknown as MahjongGameState;
applyZimoFx(st2, await prefetchZimoFx(st2));
const kept = await allRows(A);
const g2 = await post(fxPost, { userId: A }, "boss");
eq([rv.body.revoked, mine2.available, mine2.selected, deny.status, admin2.active, st2.players[0].zimoFx, kept, await auditN(A, "fx_revoke"), g2.body.granted, await permRows(A), await allRows(A)],
  [6, { golden: null }, "golden", 403, {}, { code: "golden", until: null }, 6, 1, 6, 6, 12],
  "P4 收回：6 列都收回、回到只能預覽（只剩金色）、選風暴 403、自摸金色；紀錄 6 列還在、寫 1 筆操作紀錄；再開通又是 6 列永久（共 12 列）");

// ---- M1 migration ----
const grant = (u: string, by: string, at: string, exp: string, revoked?: string) => d.query("insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at, revoked_at, revoked_by) values ($1, 'storm', $2, $3, $4, $5, $6)", [u, by, iso(at), iso(exp), revoked ? iso(revoked) : null, revoked ? BOSS : null]);
await grant(X, BOSS, "2026-11-03T12:00:00", "2026-11-16T00:00:00");
await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'storm', now())", [X]);
await grant(Y, BOSS, "2026-10-01T12:00:00", "2026-10-13T00:00:00");
await grant(Z, BOSS, "2026-11-03T12:00:00", "2026-11-16T00:00:00", "2026-11-03T13:00:00");
await grant(Q, "qa-actor-小測", "2026-11-03T12:00:00", "2026-11-16T00:00:00");
await grant(QN, BOSS, "2026-11-03T12:00:00", "2026-11-16T00:00:00");
await d.query("update auth.users set raw_user_meta_data = '{\"name\":\"qa-小測\"}' where id = $1", [QN]);
await grant(QM, BOSS, "2026-11-03T12:00:00", "2026-11-16T00:00:00");
await d.query("update auth.users set email = 'qa-x@example.com' where id = $1", [QM]);
const mig = readFileSync(path.join(MIG, "20261106_mahjong_fx_permanent.sql"), "utf8");
const before = { x: await allRows(X), aud: await n("select count(*)::int n from mj_fx_audit") };
await d.exec(mig);
const oldX = await n("select count(*)::int n from mj_fx_grants where user_id = $1 and expires_at <> 'infinity' and revoked_at is null", [X]);
const others = [await permRows(Y), await permRows(Z), await permRows(Q), await permRows(QN), await permRows(QM)];
const audX = (await d.query<{ actor_id: string; detail: { migrate: boolean } }>("select actor_id, detail from mj_fx_audit where target_user_id = $1 and action = 'fx_grant'", [X])).rows;
const audNew = await n("select count(*)::int n from mj_fx_audit") - before.aud;
const aRows = await allRows(A);
eq([await permRows(X), oldX, await allRows(X) - before.x, others, audX.map((r) => [r.actor_id, r.detail.migrate]), audNew, aRows],
  [6, 1, 6, [0, 0, 0, 0, 0], [["system", true]], 1, 12],
  "M1 有效的 X 轉永久：新增 6 列、舊列保留、1 筆操作紀錄；過期 Y、收回 Z、qa 開通者 Q、qa 名稱 QN、qa 信箱 QM 都不轉；已經永久的 A 不多寫");
const audit1 = await n("select count(*)::int n from mj_fx_audit");
await d.exec(mig);
const fxAt = async (u: string, at: string) => { clock.now = T(at); const s = { players: [{ userId: u }] } as unknown as MahjongGameState; applyZimoFx(s, await prefetchZimoFx(s)); return zimoFxValid(s.players[0].zimoFx ?? undefined, clock.now); };
await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'storm', now())", [Q]);
const qBefore = (await get(fxGet, `/?userId=${Q}`, "boss")).body.active.storm === T("2026-11-16T00:00:00");
const r1 = [await n("select count(*)::int n from mj_fx_audit") === audit1, await permRows(X), qBefore, await fxAt(Q, "2026-11-15T23:59:59"), await fxAt(Q, "2026-11-16T00:00:00"), await fxAt(X, "2026-12-01T00:00:00")];
clock.now = T("2026-11-04T12:00:00");
eq(r1, [true, 6, true, "storm", "golden", "storm"], "M1 重跑不多寫；沒轉的 qa 舊開通還是到 11/16 00:00 前有效、之後回金色；轉永久的 X 到 12 月照樣有效");

// ---- M2 回滾 ----
await post(fxPost, { userId: W }, "boss"); // 上線後才開的：只有永久列
const rb = readFileSync(path.join(MIG, "20261106_mahjong_fx_permanent_rollback.sql"), "utf8");
const allBefore = await n("select count(*)::int n from mj_fx_grants");
await d.exec(rb);
const timedW = await n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null and expires_at <> 'infinity' and expires_at > now()", [W]);
const timedX = await n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null and expires_at <> 'infinity'", [X]);
const addedX = await n("select count(*)::int n from mj_fx_audit where target_user_id = $1 and action = 'fx_grant' and (detail ->> 'rollback') = 'true'", [X]);
const allAfter = await n("select count(*)::int n from mj_fx_grants");
await d.exec(rb);
eq([await permRows(X), await permRows(W), await permRows(A), timedX, addedX, timedW, await auditN(X, "fx_revoke"), allAfter >= allBefore, await n("select count(*)::int n from mj_fx_grants") === allAfter],
  [0, 0, 0, 1, 0, 6, 1, true, true],
  "M2 回滾：永久全部收回（不刪）；X 靠舊開通繼續有效、不補開通；上線後才開的 W 補 6 列有期限開通；每人寫收回紀錄；重跑什麼都不變");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

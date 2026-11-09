// 有斗內就自動開通自摸特效（老闆 2026-11-09；20261109_mahjong_fx_auto_donate.sql），走真的 migration（PGlite）和真的 API
//   M1 套用前先用舊的 fx_grant／fx_revoke 操作紀錄模擬「老闆手動收回過」：套用時回填 mj_fx_auto_block
//      （只看真人動作：中間夾一筆 actor='system' 的 fx_grant 不算，照樣判定被擋著；最後一次是 fx_grant 的人不擋）
//   T1 打賞：有效斗內 1 筆就自動開通全部 6 種（永久、actor='system'）；操作紀錄 auto=true，後台看得到
//   T2 唯一一筆斗內作廢：自動收回系統開的那幾列；操作紀錄 auto=true
//   T3 系統自動收回之後再斗內：不算「老闆親手收回」，照樣自動開回來
//   T4 結清觸發開通；T5 撤回結清（整批作廢）觸發自動收回
//   T6 老闆手動收回過的人，之後斗內不會自動開通；老闆自己手動開通一次才解除擋
//   T7 老闆帳號不受影響：斗內給老闆帳號不會多開任何東西、不寫自動操作紀錄
//   T8 已經有有效開通（不論手動／系統）時再斗內：不會多開 6 列
//   T9 回滾：函式改回舊版、mj_fx_auto_block 整張刪掉；斗內／開通／操作紀錄一筆都沒少；重套一次（表已經不存在）照常成功
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POST as tipPost } from "../../app/api/mahjong/admin/donations/route";
import { POST as voidPost } from "../../app/api/mahjong/admin/donations/void/route";
import { POST as settlePost } from "../../app/api/mahjong/admin/settlements/route";
import { POST as revokePost } from "../../app/api/mahjong/admin/settlements/revoke/route";
import { POST as fxGrantPost } from "../../app/api/mahjong/admin/fx/route";
import { POST as fxRevokePost } from "../../app/api/mahjong/admin/fx/revoke/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { addMatch, clock, db, extraMigrations, users } from "../support/stub-zimofx-store";

extraMigrations.length = 0; // 先建好 20261109 套用前的狀態，自己決定什麼時候套
extraMigrations.push("20261104_mahjong_match_settle.sql", "20261105_mahjong_hand_results.sql", "20261107_mahjong_fx_rulai.sql");

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const uid = (n: number) => `ec000000-0000-4000-8000-00000000000${n}`;
const rid = (n: number) => `ed000000-0000-4000-8000-00000000000${n}`;
const [A, B, C, D, Z, Y, X] = [1, 2, 3, 4, 5, 6, 7].map(uid);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
for (const [u, n] of [[A, "A"], [B, "B"], [C, "C"], [D, "D"], [Z, "Z"], [Y, "Y"], [X, "X"]]) users[u] = { name: n, avatarUrl: null };
for (const u of [BOSS, A, B, C, D, Z, Y, X]) await addUser(u);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const iso = (s: string) => new Date(T(s)).toISOString();
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const call = async (fn: (r: Request) => Promise<Response>, body: object, tok = "boss") => {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const d = await db();
const n = async (sql: string, args: unknown[] = []) => Number((await d.query<{ n: number }>(sql, args)).rows[0].n);
const activeFx = (u: string) => n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null and expires_at = 'infinity'", [u]);
const allFx = (u: string) => n("select count(*)::int n from mj_fx_grants where user_id = $1", [u]);
const blocked = (u: string) => n("select count(*)::int n from mj_fx_auto_block where user_id = $1", [u]);
const auditAuto = (u: string, action: string) => n("select count(*)::int n from mj_fx_audit where target_user_id = $1 and action = $2 and (detail ->> 'auto') = 'true'", [u, action]);
const totals = async () => [await n("select count(*)::int n from mj_donations"), await n("select count(*)::int n from mj_fx_audit"), await n("select count(*)::int n from mj_fx_grants")];
let hand = 0;
const win = (room: string, u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, $2, $3, $4)", [room, ++hand, u, iso(at)]);

// ---- M1 套用前：模擬老闆過去手動操作留下的紀錄（backfill 只看這份） ----
clock.now = T("2026-11-09T09:00:00");
const seedAudit = (u: string, action: string, actor: string, at: string) =>
  d.query("insert into mj_fx_audit (at, actor_id, action, target_user_id, detail) values ($1, $2, $3, $4, '{}'::jsonb)", [iso(at), actor, action, u]);
await seedAudit(Z, "fx_grant", BOSS, "2026-11-05T10:00:00");
await seedAudit(Z, "fx_revoke", BOSS, "2026-11-05T11:00:00"); // Z：最後一次是老闆手動收回 → 應該被擋
await seedAudit(Y, "fx_revoke", BOSS, "2026-11-05T10:00:00");
await seedAudit(Y, "fx_grant", BOSS, "2026-11-05T11:00:00"); // Y：之後老闆又手動開回來 → 不擋
await seedAudit(X, "fx_revoke", BOSS, "2026-11-05T10:00:00");
await seedAudit(X, "fx_grant", "system", "2026-11-06T00:00:00"); // X：中間夾一筆系統動作，不算數 → 照樣擋
const before = await totals();

// ---- M1 套用 ----
await d.exec(readFileSync(path.join(MIG, "20261109_mahjong_fx_auto_donate.sql"), "utf8"));
eq([await blocked(Z), await blocked(Y), await blocked(X), (await totals()).join() === before.join()], [1, 0, 1, true],
  "M1 套用：回填只看真人動作——Z 最後一次是老闆手動收回、擋著；Y 之後老闆又手動開回來、不擋；X 中間那筆系統動作不算，照樣擋著；斗內／操作紀錄／開通筆數都沒變");

// ---- T1 打賞觸發開通 ----
clock.now = T("2026-11-09T10:00:00");
const t1 = await call(tipPost, { userId: A, amount: 50, donatedAt: new Date(clock.now).toISOString() });
eq([t1.status, await activeFx(A), await auditAuto(A, "fx_grant")], [200, 6, 1], "T1 A 第一次打賞：自動開通全部 6 種（永久），寫 1 筆 auto=true 的 fx_grant 操作紀錄");

// ---- T2 唯一一筆斗內作廢：自動收回 ----
const v2 = await call(voidPost, { id: t1.body.id, reason: "測試作廢" });
eq([v2.status, await activeFx(A), await auditAuto(A, "fx_revoke")], [200, 0, 1], "T2 作廢 A 唯一一筆斗內：自動收回剛開的 6 種，寫 1 筆 auto=true 的 fx_revoke 操作紀錄");

// ---- T3 系統自動收回之後再斗內：照樣自動開回來 ----
clock.now = T("2026-11-09T10:10:00");
const t3 = await call(tipPost, { userId: A, amount: 30, donatedAt: new Date(clock.now).toISOString() });
eq([t3.status, await activeFx(A), await blocked(A)], [200, 6, 0], "T3 系統自動收回不算「老闆親手收回」：A 再斗內照樣自動開回來，沒有被擋");

// ---- T4 結清觸發開通；T5 撤回結清觸發自動收回 ----
await addMatch(rid(1), "9001", T("2026-11-09T11:00:00"), T("2026-11-09T12:00:00"));
await win(rid(1), B, "2026-11-09T11:30:00");
clock.now = T("2026-11-09T12:10:00");
const t4 = await call(settlePost, { userId: B, roomIds: [rid(1)] });
eq([t4.status, await activeFx(B), await auditAuto(B, "fx_grant")], [200, 6, 1], "T4 B 結清一場：自動開通全部 6 種");
const t5 = await call(revokePost, { batchId: t4.body.batchId, reason: "按錯" });
eq([t5.status, await activeFx(B), await auditAuto(B, "fx_revoke")], [200, 0, 1], "T5 撤回 B 那批結清（唯一一筆斗內整筆作廢）：自動收回系統開的特效");

// ---- T6 老闆手動收回過的人，之後斗內不會自動開通；老闆自己手動開通才解除擋 ----
const g6 = await call(fxGrantPost, { userId: C });
const r6 = await call(fxRevokePost, { userId: C });
clock.now = T("2026-11-09T13:00:00");
const t6 = await call(tipPost, { userId: C, amount: 40, donatedAt: new Date(clock.now).toISOString() });
const after6 = [await activeFx(C), await blocked(C)];
const g6b = await call(fxGrantPost, { userId: C }); // 老闆自己手動開通
const t6b = await call(tipPost, { userId: C, amount: 40, donatedAt: new Date(clock.now).toISOString() }); // 再斗內一次不會多開（已經有效）
eq([g6.body.granted, r6.body.revoked, t6.status, after6, g6b.body.granted, t6b.status, await blocked(C), await allFx(C)], [6, 6, 200, [0, 1], 6, 200, 0, 12],
  "T6 老闆手動收回過 C：之後斗內（金額足夠）不會自動開通、擋著；老闆自己手動開通一次就解除擋、再斗內也不會多開 6 列");

// ---- T7 老闆帳號不受影響 ----
clock.now = T("2026-11-09T14:00:00");
const t7 = await call(tipPost, { userId: BOSS, amount: 100, donatedAt: new Date(clock.now).toISOString() });
eq([t7.status, await allFx(BOSS), await blocked(BOSS), await auditAuto(BOSS, "fx_grant")], [200, 0, 0, 0], "T7 打賞給老闆帳號：不會多開任何特效列、不會寫自動操作紀錄、不會留下擋的紀錄");

// ---- T8 已經有有效開通時再斗內：不會多開 ----
const g8 = await call(fxGrantPost, { userId: D });
clock.now = T("2026-11-09T15:00:00");
const t8 = await call(tipPost, { userId: D, amount: 40, donatedAt: new Date(clock.now).toISOString() });
eq([g8.body.granted, t8.status, await allFx(D), await activeFx(D)], [6, 200, 6, 6], "T8 D 已經有老闆手動開通：再斗內不會多開 6 列（本來就是開著的）");

// ---- T9 回滾 ----
const before9 = await totals();
await d.exec(readFileSync(path.join(MIG, "20261109_mahjong_fx_auto_donate_rollback.sql"), "utf8"));
const goneFn = await n("select count(*)::int n from pg_proc where proname = 'mj_fx_auto_sync'");
const goneTbl = await n("select (to_regclass('public.mj_fx_auto_block') is null)::int n");
let again = "沒擋";
try { await d.exec(readFileSync(path.join(MIG, "20261109_mahjong_fx_auto_donate.sql"), "utf8")); } catch { again = "擋下"; await d.exec("rollback"); }
eq([goneFn, goneTbl, (await totals()).join() === before9.join(), again], [0, 1, true, "沒擋"],
  "T9 回滾：mj_fx_auto_sync 拿掉、mj_fx_auto_block 整張刪掉；斗內／操作紀錄／開通筆數不變；重套一次（表已經不存在）不會被擋下，照常成功");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

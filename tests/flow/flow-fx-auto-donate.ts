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
//   T10 補開（阿哲 2026-11-09 拍板：獨立、要明確下 --apply 才寫入，和即時自動開通呼叫同一支 mj_fx_auto_sync）：
//      先直接寫入既有斗內資料（不經過 tip／settle，模擬上線前就有、從沒被同步過的舊帳），
//      再呼叫 mj_fx_auto_sync（和 scripts/mj-fx-auto-donate-backfill.ts --apply 一樣的呼叫）補開；
//      有效斗內的補開；被③擋著的不補；已經有開通的不多開；重跑第二次完全不變
//   T11 併發（審伯 2026-11-09 必修②：mj_fx_auto_sync 用玩家 id 當 key 取交易內鎖）：
//      雙連線同時觸發同一玩家的開通：恆為 6 筆有效開通、1 筆自動操作紀錄；
//      雙連線同時作廢同一玩家最後兩筆有效斗內：以兩邊都寫完之後的最終狀態決定收回，恆為 1 筆自動收回紀錄、0 筆有效開通
//   T9 回滾：函式改回舊版、系統自動開通的還有效的先收回（手動開通不動）、mj_fx_auto_block 整張刪掉；
//      斗內／結清／手動開通紀錄一筆都沒少；重套一次（表已經不存在）照常成功
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
const uid = (n: number) => `ec000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const rid = (n: number) => `ed000000-0000-4000-8000-00000000000${n}`;
const [A, B, C, D, Z, Y, X, W, V, U] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(uid);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
for (const [u, n] of [[A, "A"], [B, "B"], [C, "C"], [D, "D"], [Z, "Z"], [Y, "Y"], [X, "X"], [W, "W"], [V, "V"], [U, "U"]]) users[u] = { name: n, avatarUrl: null };
for (const u of [BOSS, A, B, C, D, Z, Y, X, W, V, U]) await addUser(u);

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
/** 直接寫一筆斗內（不經過 mj_donation_tip／mj_match_settle，不會觸發自動同步）：模擬上線前就有、從沒被同步過的舊帳 */
const rawDonation = async (u: string, amount: number, at: string): Promise<string> =>
  (await d.query<{ id: string }>("insert into mj_donations (user_id, player_name, amount, donated_at, created_by, created_at) values ($1, $2, $3, $4, 'legacy-seed', $4) returning id",
    [u, users[u]?.name ?? u, amount, iso(at)])).rows[0].id;
/** 和 scripts/mj-fx-auto-donate-backfill.ts --apply 同一支函式：直接呼叫 mj_fx_auto_sync */
const sync = (u: string) => d.query<{ r: { granted?: boolean; revoked?: boolean } }>("select public.mj_fx_auto_sync($1) as r", [u]);

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

// ---- T10 補開（直接寫入既有斗內，模擬上線前就有、從沒被同步過的舊帳；呼叫 mj_fx_auto_sync＝--apply 的做法） ----
clock.now = T("2026-11-09T16:00:00");
await rawDonation(W, 60, "2026-10-20T10:00:00"); // W：舊帳，有效斗內，從沒開通過
await rawDonation(Z, 60, "2026-10-20T10:00:00"); // Z：舊帳，但 M1 已經判定被③擋著
const s1 = await sync(W);
const s1b = await sync(W); // 重跑第二次
const s2 = await sync(Z);
const s3 = await sync(D); // D 在 T8 已經是手動開通、有效，補開不應該多開
eq([s1.rows[0].r, await activeFx(W), await auditAuto(W, "fx_grant"), s1b.rows[0].r, await allFx(W), s2.rows[0].r, await allFx(Z), s3.rows[0].r, await allFx(D)],
  [{ granted: true }, 6, 1, {}, 6, {}, 0, {}, 6],
  "T10 補開：W 這筆舊帳沒人動過，呼叫 mj_fx_auto_sync 補開 6 列、寫 1 筆自動開通紀錄，重跑第二次完全不變（還是 6 列、不多寫）；" +
  "Z 被③擋著，補開不會開通；D 已經是手動開通，補開不會多開");

// ---- T11 併發：同一玩家雙連線同時觸發 ----
clock.now = T("2026-11-09T17:00:00");
await rawDonation(V, 60, "2026-11-09T17:00:00"); // V：還沒開通過
const race1 = await Promise.all([sync(V), sync(V)]);
eq([race1.map((r) => r.rows[0].r).filter((r) => r.granted).length, await activeFx(V), await auditAuto(V, "fx_grant")], [1, 6, 1],
  "T11a 雙連線同時幫 V 開通：只有一邊真的開通（另一邊看到鎖之後的最新狀態就跳過），恆為 6 筆有效開通、1 筆自動開通紀錄");

const ut1 = await call(tipPost, { userId: U, amount: 10, donatedAt: new Date(clock.now).toISOString() });
const ut2 = await call(tipPost, { userId: U, amount: 10, donatedAt: new Date(clock.now).toISOString() });
const beforeRevoke = [await activeFx(U), await auditAuto(U, "fx_grant")];
await Promise.all([call(voidPost, { id: ut1.body.id, reason: "測試" }), call(voidPost, { id: ut2.body.id, reason: "測試" })]);
eq([beforeRevoke, await activeFx(U), await auditAuto(U, "fx_revoke")], [[6, 1], 0, 1],
  "T11b 雙連線同時作廢 U 最後兩筆有效斗內：U 原本是開著的（6 筆、1 筆開通紀錄）；兩邊都寫完之後，以最終「沒有任何有效斗內」決定收回，恆為 1 筆自動收回紀錄、0 筆有效開通（不會因為各自只看到另一筆還有效而兩邊都漏收回）");

// ---- T9 回滾 ----
const before9 = await totals();
await d.exec(readFileSync(path.join(MIG, "20261109_mahjong_fx_auto_donate_rollback.sql"), "utf8"));
const goneFn = await n("select count(*)::int n from pg_proc where proname = 'mj_fx_auto_sync'");
const goneTbl = await n("select (to_regclass('public.mj_fx_auto_block') is null)::int n");
const stillActiveManual = await n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null", [D]); // D 是手動開通，回滾不該動
const systemRevoked = await n("select count(*)::int n from mj_fx_grants where granted_by = 'system:donate' and revoked_at is null"); // 回滾後系統開的全部收回
const rollbackAudit = await n("select count(*)::int n from mj_fx_audit where action = 'fx_revoke' and (detail ->> 'rollback') = 'true'");
const after9 = await totals();
let again = "沒擋";
try { await d.exec(readFileSync(path.join(MIG, "20261109_mahjong_fx_auto_donate.sql"), "utf8")); } catch { again = "擋下"; await d.exec("rollback"); }
eq([goneFn, goneTbl, stillActiveManual, systemRevoked, rollbackAudit > 0, after9[0] === before9[0], after9[2] === before9[2], after9[1] > before9[1], again],
  [0, 1, 6, 0, true, true, true, true, "沒擋"],
  "T9 回滾：mj_fx_auto_sync 拿掉；D 的手動開通完全不動還是 6 列；所有系統自動開通（granted_by='system:donate'）都收回、寫可辨識的 rollback 操作紀錄；" +
  "mj_fx_auto_block 整張刪掉；斗內筆數、開通紀錄筆數（只是標收回，不刪）都沒變，只有操作紀錄因為新寫的 rollback 收回紀錄而增加；重套一次（表已經不存在）不會被擋下，照常成功");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

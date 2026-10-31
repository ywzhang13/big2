// 11/1 重置的兩個防呆（2026-11-01 審伯複查；20261103_mahjong_donate_reset_1101.sql＋回滾檔），走真的 migration（PGlite）和真的記帳 API
//   W1 起算點：11/1 00:00 之後、重置之前就記過帳的人，00:00 之後的自摸不會被漏算
//      E 舊欠 3、00:30 自摸、01:00 斗 NT$10（抵 1 剩 3）、03:00 重置 → 1（00:30 那次；記帳先扣舊的）
//      F 沒舊欠、00:30 自摸、01:00 斗 NT$10 → 0（那次已經付了）；G 舊欠 2、00:30 自摸、01:00 斗 NT$100 → 0；H 舊欠 1、00:30 自摸、沒記帳 → 1
//   W2 回滾不蓋掉重置後的事：E 重置後又自摸、看過斗內卡；H 重置後記帳 → 看過、抵扣都保留，只加回清掉的次數；F、G 沒動過 → 整列還原成備份
//   W3 回滾只做一次：再跑什麼都不變；備份表改名保留，不刪；自摸、斗內、操作紀錄筆數都沒變
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POST as donationsAdd } from "../../app/api/mahjong/admin/donations/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const id = (n: number) => `ed000000-0000-4000-8000-00000000000${n}`;
const [E, F, G, H] = [1, 2, 3, 4].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
["阿明", "阿華", "小美", "阿強"].forEach((n, i) => (users[id(i + 1)] = { name: n, avatarUrl: null }));
for (const u of [BOSS, E, F, G, H]) await addUser(u);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const d = await db();
let room = 0;
const win = (u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3)", [`ec000000-0000-4000-8000-${String(++room).padStart(12, "0")}`, u, new Date(T(at)).toISOString()]);
const donate = async (u: string, amount: number, at: string) => {
  clock.now = T(at);
  const r = await donationsAdd(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer boss" }, body: JSON.stringify({ userId: u, amount, donatedAt: new Date(clock.now).toISOString() }) }));
  return (await r.json()).deduction;
};
const count = async (u: string) => Number((await d.query<{ n: number }>("select public.mj_donate_count($1) n", [u])).rows[0].n);
const counts = async () => ({ E: await count(E), F: await count(F), G: await count(G), H: await count(H) });
const n = async (sql: string) => Number((await d.query<{ n: number }>(sql)).rows[0].n);
const tables = async () => [await n("select count(*)::int n from mj_zimo_wins"), await n("select count(*)::int n from mj_donations"), await n("select count(*)::int n from mj_fx_audit")];
type Row = { user_id: string; acked_at: Date; carried: number; seen_count: number; reset_source: string | null; reset_cleared: number | null };
const row = async (u: string, t = "mj_donate_acks") => (await d.query<Row>(`select user_id, acked_at, carried, seen_count, reset_source, reset_cleared from ${t} where user_id = $1`, [u])).rows[0] ?? null;

// ---- 10 月的舊欠：E 3、G 2、H 1；F 沒有 ----
clock.now = T("2026-10-20T12:00:00");
for (let i = 0; i < 3; i++) await win(E, "2026-10-15T20:00:00");
for (let i = 0; i < 2; i++) await win(G, "2026-10-15T20:00:00");
await win(H, "2026-10-15T20:00:00");
// ---- 11/1 00:00～03:00：每人 00:30 自摸一次；01:00 記帳 ----
for (const u of [E, F, G, H]) await win(u, "2026-11-01T00:30:00");
const dE = await donate(E, 10, "2026-11-01T01:00:00");
const dF = await donate(F, 10, "2026-11-01T01:00:00");
const dG = await donate(G, 100, "2026-11-01T01:00:00");
const pre = await counts();

clock.now = T("2026-11-01T03:00:00");
await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101.sql"), "utf8"));
const after = await counts();
const rE = (await row(E))!, rH = (await row(H))!;
const rec = (await d.query<{ detail: { users: number; cleared: number } }>("select detail from mj_fx_audit where action = 'zimo_reset_all'")).rows[0].detail;
eq([[dE.before, dE.deducted, dE.remaining], [dF.before, dF.deducted, dF.remaining], [dG.before, dG.deducted, dG.remaining], pre],
  [[4, 1, 3], [1, 1, 0], [3, 3, 0], { E: 3, F: 0, G: 0, H: 2 }], "W1 前提：01:00 記帳 E 4 抵 1 剩 3、F 1 抵 1 剩 0、G 3 抵 3 剩 0；重置前 E 3、F 0、G 0、H 2");
eq([after, [rE.carried, rE.reset_cleared, new Date(rE.acked_at).getTime() === T("2026-11-01T01:00:00")], [rH.carried, rH.reset_cleared, new Date(rH.acked_at).getTime() === T("2026-11-01T00:00:00")], [rec.users, rec.cleared]],
  [{ E: 1, F: 0, G: 0, H: 1 }, [1, 2, true], [0, 1, true], [4, 3]],
  "W1 03:00 重置：E 保留 00:30 那 1 次（清掉舊的 2 次、歸零點留在 01:00）、F 0、G 0、H 1（歸零點 00:00）；操作紀錄 4 人、共清掉 2＋1＝3 次");

// ---- 重置後：E 04:00 自摸、看過斗內卡（2 次）；H 04:10 記帳 NT$10 ----
clock.now = T("2026-11-01T04:00:00");
await win(E, "2026-11-01T04:00:00");
await d.query("select * from mj_donate_seen($1, 2)", [E]);
const dH = await donate(H, 10, "2026-11-01T04:10:00");
const backupF = JSON.stringify(await row(F, "mj_donate_acks_backup_20261101")), backupG = JSON.stringify(await row(G, "mj_donate_acks_backup_20261101"));
const t0 = await tables();

await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101_rollback.sql"), "utf8"));
const rb = await counts();
const rE2 = (await row(E))!, rH2 = (await row(H))!;
eq([[dH.before, dH.deducted], rb, [rE2.carried, rE2.seen_count], [rH2.carried, rH2.reset_source, new Date(rH2.acked_at).getTime() === T("2026-11-01T04:10:00")], JSON.stringify(await row(F)) === backupF, JSON.stringify(await row(G)) === backupG],
  [[1, 1], { E: 4, F: 0, G: 0, H: 1 }, [3, 2], [1, "donation", true], true, true],
  "W2 回滾：E＝重置前 3＋重置後 1＝4，看過 2 保留；H 重置後那筆抵扣保留（歸零點 04:10），只加回清掉的 1 次＝1；F、G 重置後沒動過 → 整列和備份一樣");

const acks1 = JSON.stringify((await d.query("select * from mj_donate_acks order by user_id")).rows);
await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101_rollback.sql"), "utf8"));
const acks2 = JSON.stringify((await d.query("select * from mj_donate_acks order by user_id")).rows);
const tbl = (await d.query<{ a: string | null; b: string | null }>("select to_regclass('public.mj_donate_acks_backup_20261101')::text a, to_regclass('public.mj_donate_acks_backup_20261101_rolled_back')::text b")).rows[0];
eq([acks1 === acks2, tbl.a, tbl.b !== null, await n("select count(*)::int n from mj_donate_acks_backup_20261101_rolled_back") > 0, (await tables()).join() === t0.join()],
  [true, null, true, true, true], "W3 回滾再跑一次什麼都不變；備份表改名保留（資料還在）；自摸、斗內、操作紀錄筆數都沒變");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

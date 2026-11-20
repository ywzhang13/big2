// 房卡 migration（20261120_room_cards.sql）的資料庫層檢查，PGlite 跑真的 SQL（老柯 2026-11-20）
//   Q1 流水帳、暫停紀錄只能新增：改、刪都被擋
//   Q2 權限：anon、authenticated 讀不到三張表、不能執行任何房卡函式；service_role 可以
//   Q3 同一把同時扣、重複扣：資料庫唯一索引擋（直接 insert 第二筆也失敗）
//   Q4 不碰別的表：套用前後麻將、十三支的表和資料都沒變
//   Q5 回滾檔刪乾淨、可以再套一次；重複套用會被擋
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_SETUP } from "./support/pg-mj";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const up = readFileSync(path.join(MIG, "20261120_room_cards.sql"), "utf8");
const down = readFileSync(path.join(MIG, "20261120_room_cards_rollback.sql"), "utf8");
const d = new PGlite();
await d.exec(SUPABASE_SETUP);
await d.exec(`create table public.mj_rooms (id uuid primary key, code text, status text);
  create table public.mj_players (room_id uuid, user_id uuid);
  create table public.th_rooms (id uuid primary key, code text, status text);
  create table public.th_players (room_id uuid, user_id uuid);
  insert into mj_rooms values ('11111111-0000-4000-8000-000000000001', '1234', 'playing');
  insert into mj_players values ('11111111-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1');`);
const snapshot = async () => JSON.stringify((await d.query(`select (select json_agg(r) from mj_rooms r) a, (select json_agg(p) from mj_players p) b`)).rows);
const before = await snapshot();
await d.exec(up);
const U = "00000000-0000-4000-8000-0000000000a1";
const tryq = async (sql: string, role?: string) => {
  try { if (role) await d.exec(`set role ${role}`); await d.query(sql); return "ok"; }
  catch { return "擋下"; } finally { if (role) await d.exec("reset role"); }
};

// Q1
await d.query(`select room_card_charge('mahjong', 'r1', '1234', 1, array['${U}']::uuid[])`);
await d.query(`select room_card_set_suspended('boss', '${U}', true, '00000000-0000-4000-9000-000000000001')`);
eq([await tryq("update room_card_ledger set delta = -5"), await tryq("delete from room_card_ledger"), await tryq("update room_card_audit set action = 'resume'"), await tryq("delete from room_card_audit")],
  ["擋下", "擋下", "擋下", "擋下"], "Q1 流水帳、暫停紀錄改、刪都被擋");
// Q2
const anon = [];
for (const role of ["anon", "authenticated"]) {
  for (const t of ["room_card_accounts", "room_card_ledger", "room_card_audit", "room_card_ops"]) anon.push(await tryq(`select * from ${t}`, role));
  anon.push(await tryq(`select room_card_charge('mahjong', 'r9', '1', 1, array['${U}']::uuid[])`, role));
  anon.push(await tryq(`select room_card_topup('x', '${U}', 5, '00000000-0000-4000-9000-000000000002')`, role));
  anon.push(await tryq(`select * from room_card_players()`, role));
}
eq([...new Set(anon)], ["擋下"], "Q2 anon、authenticated 讀不到四張表（含操作編號表）、不能執行房卡函式");
eq([await tryq(`select * from room_card_accounts`, "service_role"), await tryq(`select room_card_topup('boss', '${U}', 5, '00000000-0000-4000-9000-000000000003')`, "service_role"),
  await tryq(`select * from room_card_players()`, "service_role")], ["ok", "ok", "ok"], "Q2 service_role（伺服器）可以讀寫");
// Q3
const again = await d.query<{ n: number }>(`select room_card_charge('mahjong', 'r1', '1234', 1, array['${U}', '${U}']::uuid[]) n`);
const dup = await tryq(`insert into room_card_ledger (user_id, kind, delta, balance_after, game, room_id, hand_no, actor) values ('${U}', 'charge', -1, 0, 'mahjong', 'r1', 1, 'x')`);
const playing = (await d.query<{ playing_game: string; playing_code: string; suspended_at: unknown }>(`select * from room_card_players()`)).rows[0];
eq([again.rows[0].n, dup, (await d.query<{ balance: number }>(`select balance from room_card_accounts`)).rows[0].balance, playing.playing_game, playing.playing_code, !!playing.suspended_at],
  [0, "擋下", 4, "mahjong", "1234", true], "Q3 同一把再扣一次（含重複帳號）0 人、直接 insert 第二筆被唯一索引擋；餘額 −1＋5＝4；名單看得到正在打的麻將房、暫停中");
// Q6：同一個操作編號拿去給不同的人做不同的事（充值、回收、暫停、恢復）：只有第一個成功，其他都是 op_conflict、什麼都不寫
{
  const V = "00000000-0000-4000-8000-0000000000b2", OP = "00000000-0000-4000-9000-0000000000f6";
  const r = [];
  r.push((await d.query<{ r: { ok: boolean } }>(`select room_card_set_suspended('boss', '${V}', false, '${OP}') r`)).rows[0].r); // 狀態沒變的恢復也佔住編號
  r.push((await d.query<{ r: { ok: boolean; error?: string } }>(`select room_card_topup('boss', '${U}', 5, '${OP}') r`)).rows[0].r);
  r.push((await d.query<{ r: { ok: boolean; error?: string } }>(`select room_card_reclaim('boss', '${V}', 5, '${OP}') r`)).rows[0].r);
  r.push((await d.query<{ r: { ok: boolean; error?: string } }>(`select room_card_set_suspended('boss', '${U}', false, '${OP}') r`)).rows[0].r);
  const n = (await d.query<{ l: number; a: number; o: number }>(`select (select count(*)::int from room_card_ledger where op_id = '${OP}') l, (select count(*)::int from room_card_audit where op_id = '${OP}') a, (select count(*)::int from room_card_ops where op_id = '${OP}') o`)).rows[0];
  eq([r.map((x) => (x as { ok: boolean; error?: string }).ok ? "ok" : (x as { error?: string }).error), n], [["ok", "op_conflict", "op_conflict", "op_conflict"], { l: 0, a: 0, o: 1 }],
    "Q6 同一個編號跨人、跨動作：只有第一個（沒改狀態的恢復）成功並佔住編號，其他 3 個 op_conflict、沒寫任何帳和紀錄");
}
// Q4
eq(await snapshot(), before, "Q4 麻將房間、座位資料沒被動到");
// Q5
const reapply = await tryq(up);
await d.exec(down);
const left = (await d.query<{ n: number }>(`select count(*)::int n from pg_class where relname like 'room_card%'`)).rows[0].n
  + (await d.query<{ n: number }>(`select count(*)::int n from pg_proc where proname like 'room_card%'`)).rows[0].n;
await d.exec(up);
eq([reapply, left, await snapshot(), (await d.query<{ n: number }>(`select count(*)::int n from room_card_ledger`)).rows[0].n], ["擋下", 0, before, 0],
  "Q5 重複套用被擋；回滾刪乾淨（表、索引、序號、函式 0 個）、別的表不動；回滾後可以再套一次");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

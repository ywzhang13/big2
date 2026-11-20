// 第二批兩份 migration 的資料庫層檢查（老柯 2026-11-20），PGlite 跑真的 SQL
//   Q1 my_matches、room_card_ledger_all：anon、authenticated 不能執行，service_role 可以
//   Q2 只新增函式：套用前後所有表的欄位、資料都沒變
//   Q3 回滾檔刪乾淨、可以再套一次；重複套用會被擋；ledger_all 沒先套房卡會被擋
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
const sql = (f: string) => readFileSync(path.join(MIG, f), "utf8");
const d = new PGlite();
await d.exec(SUPABASE_SETUP);
await d.exec(`create table public.mj_rooms (id uuid primary key, code text, status text); create table public.mj_players (room_id uuid, user_id uuid);
  create table public.th_rooms (id uuid primary key, code text, status text); create table public.th_players (room_id uuid, user_id uuid);`);
const tryq = async (q: string, role?: string) => {
  try { if (role) await d.exec(`set role ${role}`); await d.query(q); return "ok"; } catch { return "擋下"; } finally { if (role) await d.exec("reset role"); }
};
const early = await tryq(sql("20261120_room_cards_ledger_all.sql"));
// 對局紀錄表（正式庫由 20261016_match_records.sql 建，那份要先有大老二的表；這裡照它的欄位只建這兩張）
await d.exec(`create table public.match_records (id uuid primary key default gen_random_uuid(), game text not null, room_id uuid not null, room_code char(4) not null,
  started_at timestamptz, ended_at timestamptz not null default now(), end_reason text not null, total_rounds int, base_points int, fan_points int,
  settings jsonb not null default '{}', hands_played int, created_at timestamptz not null default now(), unique (game, room_id));
  create table public.match_record_players (match_id uuid not null references match_records(id) on delete cascade, seat int not null, player_name text not null,
  player_id text not null, total_score int not null, user_id uuid, primary key (match_id, seat));`);
await d.exec(sql("20261120_room_cards.sql"));
const U = "00000000-0000-4000-8000-0000000000a1";
await d.query(`select room_card_topup('boss', '${U}', 5, '00000000-0000-4000-9000-000000000001')`);
await d.query(`insert into match_records (game, room_id, room_code, end_reason) values ('mahjong', gen_random_uuid(), '1234', 'completed')`);
const shape = async () => JSON.stringify((await d.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows)
  + JSON.stringify((await d.query(`select (select count(*) from match_records) m, (select count(*) from room_card_ledger) l, (select count(*) from room_card_accounts) a`)).rows);
const before = await shape();
await d.exec(sql("20261120_match_history.sql"));
await d.exec(sql("20261120_room_cards_ledger_all.sql"));
// Q1
const calls = [`select my_matches('${U}', 'all', 10, null, null)`, `select room_card_ledger_all(null, null, 10, null, null, null, null)`];
const denied = [];
for (const role of ["anon", "authenticated"]) for (const c of calls) denied.push(await tryq(c, role));
eq([[...new Set(denied)], await tryq(calls[0], "service_role"), await tryq(calls[1], "service_role")], [["擋下"], "ok", "ok"], "Q1 兩個新函式：anon、authenticated 不能執行，service_role 可以");
// Q2
eq(await shape(), before, "Q2 只新增函式：所有表的欄位和資料筆數都沒變");
// Q3
const again = [await tryq(sql("20261120_match_history.sql")), await tryq(sql("20261120_room_cards_ledger_all.sql"))];
await d.exec(sql("20261120_match_history_rollback.sql"));
await d.exec(sql("20261120_room_cards_ledger_all_rollback.sql"));
const left = (await d.query<{ n: number }>(`select count(*)::int n from pg_proc where proname in ('my_matches', 'room_card_ledger_all')`)).rows[0].n;
const after = await shape();
await d.exec(sql("20261120_match_history.sql"));
await d.exec(sql("20261120_room_cards_ledger_all.sql"));
eq([early, again, left, after === before, await tryq(calls[0], "service_role")], ["擋下", ["擋下", "擋下"], 0, true, "ok"],
  "Q3 沒先套房卡就套全部流水帳被擋；重複套用被擋；回滾刪乾淨、資料不動；回滾後可以再套一次");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

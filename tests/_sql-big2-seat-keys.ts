// 大老二入座憑證雜湊的資料庫權限（老柯 2026-11-20，審伯複審 R4 的資料庫路徑）：PGlite 跑 schema.sql＋20261120_big2_start_confirm.sql，
// 先照 Supabase 正式站的預設給 anon、authenticated、service_role public 表的完整權限（新表也會自動拿到），再看憑證雜湊擋不擋得住。
//   K1 anon、一般登入（authenticated）讀不到任何一個座位的憑證雜湊
//   K2 anon、一般登入改不了、也塞不進憑證雜湊（不能把房主的換成自己選的值）
//   K3 伺服器（service_role）照常讀寫
//   K4 大老二原本靠公開金鑰運作的房間、座位欄位照常讀寫（遊戲流程不壞）
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
await db.exec(readFileSync(path.join(root, "supabase/schema.sql"), "utf8").replace(/alter publication[^;]*;/gi, ""));
await db.exec(readFileSync(path.join(root, "supabase/migrations/20261120_big2_start_confirm.sql"), "utf8"));
const room = (await db.query<{ id: string }>(`insert into big2_rooms (code, host_id) values ('7001', 'h') returning id`)).rows[0].id;
await db.query(`insert into big2_players (room_id, player_id, name, seat) values ($1, 'h', '房主', 0)`, [room]);
const hasTable = !!(await db.query<{ t: string | null }>(`select to_regclass('public.big2_seat_keys')::text t`)).rows[0].t;
const hasColumn = (await db.query(`select 1 from information_schema.columns where table_name = 'big2_players' and column_name = 'seat_key_hash'`)).rows.length > 0;
// 房主真的憑證雜湊（伺服器寫的）：放在哪就寫在哪
if (hasTable) await db.query(`insert into big2_seat_keys (room_id, player_id, key_hash) values ($1, 'h', 'real-hash')`, [room]);
if (hasColumn) await db.query(`update big2_players set seat_key_hash = 'real-hash' where room_id = $1 and player_id = 'h'`, [room]);

/** 以某個角色執行；回傳讀到的列，或「擋下」 */
async function as<T>(role: string, sql: string, params: unknown[] = []): Promise<T[] | "擋下"> {
  try { await db.exec(`set role ${role}`); return (await db.query<T>(sql, params)).rows; } catch { return "擋下"; } finally { await db.exec("reset role"); }
}
const leaked = (r: unknown) => Array.isArray(r) && JSON.stringify(r).includes("real-hash");
const storedHash = async () => (hasTable
  ? (await db.query<{ h: string }>(`select key_hash h from big2_seat_keys where room_id = $1 and player_id = 'h'`, [room])).rows[0]?.h
  : (await db.query<{ h: string }>(`select seat_key_hash h from big2_players where room_id = $1 and player_id = 'h'`, [room])).rows[0]?.h) ?? null;

for (const role of ["anon", "authenticated"]) {
  const reads = [
    await as(role, `select seat_key_hash from big2_players where room_id = $1`, [room]),
    await as(role, `select * from big2_players where room_id = $1`, [room]),
    await as(role, `select * from big2_seat_keys`),
  ];
  eq(reads.map(leaked), [false, false, false], `K1 ${role} 讀不到房主的憑證雜湊（三種查法都拿不到）`);
  await as(role, `update big2_players set seat_key_hash = 'attacker' where room_id = $1 and player_id = 'h'`, [room]);
  await as(role, `update big2_seat_keys set key_hash = 'attacker' where room_id = $1 and player_id = 'h'`, [room]);
  await as(role, `delete from big2_seat_keys where room_id = $1`, [room]);
  await as(role, `insert into big2_seat_keys (room_id, player_id, key_hash) values ($1, 'h', 'attacker') on conflict do nothing`, [room]);
  eq(await storedHash(), "real-hash", `K2 ${role} 改不了、刪不掉、也塞不進房主的憑證雜湊（還是伺服器寫的那個）`);
}
const svc = await as<{ key_hash: string }>("service_role", `select key_hash from big2_seat_keys where room_id = $1`, [room]);
const svcWrite = await as("service_role", `insert into big2_seat_keys (room_id, player_id, key_hash) values ($1, 'p2', 'h2') on conflict (room_id, player_id) do update set key_hash = excluded.key_hash returning player_id`, [room]);
eq([hasTable, hasColumn, Array.isArray(svc) ? svc.map((r) => r.key_hash) : svc, Array.isArray(svcWrite) ? svcWrite.length : svcWrite], [true, false, ["real-hash"], 1],
  "K3 憑證雜湊放在獨立的 big2_seat_keys（big2_players 沒有這一欄）；伺服器（service_role）照常讀寫");
const anonGame = [
  await as("anon", `update big2_rooms set status = 'ready_check', start_confirm = '{"id":"x"}' where id = $1 returning status`, [room]),
  await as("anon", `insert into big2_players (room_id, player_id, name, seat) values ($1, 'p1', '玩家', 1) returning seat`, [room]),
  await as("anon", `select player_id, name, seat from big2_players where room_id = $1 order by seat`, [room]),
];
eq(anonGame.map((r) => (Array.isArray(r) ? r.length : r)), [1, 1, 2], "K4 大老二原本靠公開金鑰的房間、座位欄位照常讀寫（遊戲流程不壞）");
// 房間刪掉時憑證跟著刪
await db.query(`delete from big2_rooms where id = $1`, [room]);
eq(hasTable ? (await db.query<{ n: number }>(`select count(*)::int n from big2_seat_keys`)).rows[0].n : -1, 0, "K5 房間刪掉時，這間房的憑證雜湊跟著刪");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

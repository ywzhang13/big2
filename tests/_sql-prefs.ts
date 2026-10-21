// 在記憶體 PostgreSQL（PGlite）跑 20261022_mahjong_prefs.sql 和回滾，驗證：
//   Q1 公開金鑰（anon、authenticated）讀、寫、清空偏好設定表全部 permission denied；service_role 可以；沒有 policy
//   Q2 資料庫這層也擋：prefs 一定是格式 v2 的 JSON 物件（剛好 v、back、felt，v = 2，帶 face 或舊的 v1 都不收）、不超過 1KB
//   Q3 自我檢查：權限收不乾淨（別的 grantor 給的）就整份不生效、狀態不變
//   Q4 重跑不出錯、不重設；回滾後 public schema 和套用前完全一致；回滾可以重跑
//   Q5 正式庫上本來就有同名的表、同名的主鍵索引（不是這份建的、沒有 anon 權限）：套用拒絕、回滾不刪別人的，狀態完全不變
//   Q6 外鍵依實際定義判斷：別的表有同名限制照樣建好、外鍵被刪後重跑補回、本表同名但不是外鍵就拒絕、沒有 auth.users 就拒絕；
//      刪帳號連帶刪除
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const sql = (f: string) => readFileSync(path.join(MIG, f), "utf8");
const APPLY = "20261022_mahjong_prefs.sql", ROLLBACK = "20261022_mahjong_prefs_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Row = Record<string, unknown>;
const A = "aaaaaaaa-0000-4000-8000-000000000000", B = "bbbbbbbb-0000-4000-8000-000000000000";
async function setup() {
  const db = new PGlite();
  // Supabase 的角色與預設權限：新表預設會給 anon、authenticated（migration 要自己收回）
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table other_table (id int); insert into other_table values (1);
    create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');
    insert into auth.users (id) values ('${A}'), ('${B}');
  `);
  return db;
}
async function as(db: PGlite, role: string, q: string): Promise<string> {
  await db.exec(`set role ${role}`);
  try { await db.query(q); return "ok"; } catch (e) { return (e as Error).message.includes("permission denied") ? "denied" : "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
async function tryExec(db: PGlite, file: string): Promise<string> {
  try { await db.exec(sql(file)); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return (e as Error).message; }
}
/** public schema 的完整樣子（表、欄位、索引、限制、權限、註解、policy、資料） */
async function snapshot(db: PGlite) {
  const q = async (s: string) => (await db.query<Row>(s)).rows;
  const data = async (t: string) => ((await q(`select to_regclass('public.${t}') is not null as x`))[0].x ? q(`select to_jsonb(r)::text j from public.${t} r order by 1`) : null);
  return {
    tables: await q(`select c.relname, c.relkind::text, c.relacl::text acl, c.relrowsecurity, obj_description(c.oid, 'pg_class') cmt
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','i','S') order by 1`),
    columns: await q("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, ordinal_position"),
    indexes: await q("select indexname, tablename, indexdef from pg_indexes where schemaname = 'public' order by 1"),
    constraints: await q("select conname, conrelid::regclass::text tbl, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2"),
    policies: await q("select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2"),
    data: [await data("other_table"), await data("mj_user_prefs")],
  };
}
const fkOk = async (db: PGlite) => (await db.query<Row>(`select count(*)::int n from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
  where c.conrelid = 'public.mj_user_prefs'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'`)).rows[0].n === 1;
const P = `'{"v":2,"back":"sakura","felt":"night"}'`;

{
  const db = await setup();
  const before = await snapshot(db);
  await db.exec(sql(APPLY));

  // Q1
  eq(await Promise.all([
    as(db, "anon", "select * from mj_user_prefs"),
    as(db, "anon", `insert into mj_user_prefs (user_id, prefs) values ('${A}', ${P})`),
    as(db, "anon", "update mj_user_prefs set prefs = '{}'"),
    as(db, "authenticated", "select * from mj_user_prefs"),
    as(db, "authenticated", "delete from mj_user_prefs"),
    as(db, "anon", "truncate mj_user_prefs"),
  ]), Array(6).fill("denied"), "Q1a anon、authenticated 讀、新增、修改、刪除、清空全部 permission denied");
  eq([await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${A}', ${P})`), await as(db, "service_role", "select * from mj_user_prefs")], ["ok", "ok"],
    "Q1b service_role（伺服器）可以讀寫");
  eq((await db.query<Row>("select count(*)::int n from pg_policies where tablename = 'mj_user_prefs'")).rows[0].n, 0, "Q1c 表上沒有任何 policy");

  // Q2
  const big = JSON.stringify({ v: 2, back: "x".repeat(2000), felt: "night" });
  const ins = async (prefs: string) => (await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${B}', '${prefs}')`)).includes("check");
  eq([
    await ins('{"v":2,"back":"sakura","face":"ivory","felt":"night"}'),
    await ins('{"v":1,"back":"sakura","face":"ivory","felt":"night"}'),
    await ins('{"v":1,"back":"sakura","felt":"night"}'),
    await ins('{"v":2,"back":"sakura"}'),
    await ins('{"v":"2","back":"sakura","felt":"night"}'),
    await ins('{"v":2,"back":1,"felt":"night"}'),
    await ins('{"v":2,"back":"sakura","felt":null}'),
    (await db.query<Row>(`select count(*)::int n from mj_user_prefs where user_id = '${B}'`)).rows[0].n,
  ], [true, true, true, true, true, true, true, 0],
    "Q2a 資料庫也擋格式：帶 face、舊的 v1（有沒有 face 都一樣）、少欄位、v 是字串、back 不是字串、felt 是 null 都寫不進去");
  eq([
    (await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${B}', '[1,2]')`)).includes("check"),
    (await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${B}', '"sakura"')`)).includes("check"),
    (await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${B}', '${big}')`)).includes("check"),
    (await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('cccccccc-0000-4000-8000-000000000000', ${P})`)).includes("foreign key"),
  ], [true, true, true, true], "Q2b 資料庫也擋：陣列、字串、超過 1KB 都寫不進去（是違反 check，不是別的錯）；不存在的帳號寫不進去（外鍵）");

  // Q4
  const dataBefore = (await snapshot(db)).data;
  await db.exec(sql(APPLY));
  eq([JSON.stringify((await snapshot(db)).data) === JSON.stringify(dataBefore), await as(db, "anon", "select * from mj_user_prefs"), await fkOk(db)], [true, "denied", true],
    "Q4a 重跑不出錯、資料不重設、權限仍然鎖著、外鍵還在");
  await db.exec(sql(ROLLBACK));
  eq(JSON.stringify(await snapshot(db)) === JSON.stringify(before), true, "Q4b 回滾後 public schema（表、欄位、索引、限制、權限、policy、其他資料）和套用前完全一致");
  eq([await tryExec(db, ROLLBACK), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], ["ok", true], "Q4c 回滾重跑不出錯、狀態不變");
  eq([await tryExec(db, APPLY), await fkOk(db)], ["ok", true], "Q4d 回滾後可以再套用一次");
}

// Q3 自我檢查
{
  const db = await setup();
  await db.exec(sql(APPLY));
  await db.exec(`
    create role other_owner nologin; grant usage on schema public to other_owner;
    grant select on public.mj_user_prefs to other_owner with grant option;
    set role other_owner; grant select on public.mj_user_prefs to anon; reset role;
  `);
  const before = await snapshot(db);
  const err = await tryExec(db, APPLY);
  eq([err.includes("鎖權限沒有完成"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true], "Q3 權限收不乾淨（別的 grantor 給的）→ 自我檢查丟錯，整份不生效，狀態不變");
}

// Q5 既有同名物件（沒有 anon 權限）
for (const [label, name, ddl, rollbackRefuses] of [
  ["Q5a 同名的表", "mj_user_prefs", `create table public.mj_user_prefs (id serial primary key, note text); revoke all on public.mj_user_prefs from anon, authenticated;
    insert into public.mj_user_prefs (note) values ('別人的資料');`, true],
  ["Q5b 同名的主鍵索引", "mj_user_prefs_pkey", `create table public.other_log (id int); revoke all on public.other_log from anon, authenticated;
    create index mj_user_prefs_pkey on public.other_log (id);`, false],
] as [string, string, string, boolean][]) {
  const db = await setup();
  await db.exec(ddl);
  const before = await snapshot(db);
  const applied = await tryExec(db, APPLY);
  eq([applied.includes("拒絕套用") && applied.includes(name), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true], `${label}：套用 → 明確拒絕，狀態完全不變`);
  const rolled = await tryExec(db, ROLLBACK);
  eq([rollbackRefuses ? rolled.includes("拒絕回滾") : rolled === "ok", JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    `${label}：直接跑回滾 → ${rollbackRefuses ? "明確拒絕" : "沒有這份建的東西，什麼都不做"}，別人的物件沒被刪，狀態完全不變`);
}

// Q6 外鍵
{
  const db = await setup();
  await db.exec(`create table public.someone_else (user_id uuid constraint mj_user_prefs_user_id_fkey references auth.users (id)); revoke all on public.someone_else from anon, authenticated;`);
  eq([await tryExec(db, APPLY), await fkOk(db)], ["ok", true], "Q6a 別的表上有同名的限制：本表的外鍵照樣建好（不是只看名稱）");
  await db.exec(`insert into mj_user_prefs (user_id, prefs) values ('${A}', ${P}), ('${B}', ${P}); delete from auth.users where id = '${A}';`);
  eq((await db.query<Row>("select user_id::text from mj_user_prefs")).rows.map((r) => r.user_id), [B], "Q6b 刪掉 A 的帳號：A 的偏好設定跟著刪，B 不動");
  await db.exec("alter table mj_user_prefs drop constraint mj_user_prefs_user_id_fkey");
  eq([await tryExec(db, APPLY), await fkOk(db)], ["ok", true], "Q6c 外鍵被刪掉後重跑：補回來");
  await db.exec("alter table mj_user_prefs drop constraint mj_user_prefs_user_id_fkey; alter table mj_user_prefs add constraint mj_user_prefs_user_id_fkey check (user_id is not null);");
  const before = await snapshot(db);
  const bad = await tryExec(db, APPLY);
  eq([bad.includes("拒絕套用") && bad.includes("mj_user_prefs_user_id_fkey"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    "Q6d 本表有同名、但不是外鍵的限制：拒絕套用，狀態不變");
}
{
  const db = await setup(); await db.exec("drop table auth.users");
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("找不到 auth.users"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true], "Q6e 沒有 auth.users：拒絕套用，什麼都沒建");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

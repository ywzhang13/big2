// 在記憶體 PostgreSQL（PGlite）跑 20261021_mahjong_donate.sql 和回滾，驗證：
//   Q1 公開金鑰（anon、authenticated）讀寫兩張表、呼叫三個函式全部 permission denied；service_role 可以
//   Q2 自我檢查：權限收不乾淨（別的 grantor 給的）就整份不生效、狀態不變
//   Q3 函式：同一局重記不多算、歸零點只往後移、歸零後從 1 算、各帳號獨立、次數不會是負數
//   Q4 重跑不出錯、不重設；回滾後 public schema 和套用前完全一致
//   Q5～Q7 正式庫上本來就有同名的表／函式／索引（不是這份建的、沒有 anon 權限）：套用、回滾都拒絕，狀態完全不變
//   Q8 遊客不記：mj_zimo_record 以 auth.users 為準，遊客、不存在的帳號都不寫入
//   Q9～Q12 外鍵：兩張表都有 user_id → auth.users(id) on delete cascade；判斷看實際定義不看名稱
//      （別的表有同名限制也照樣建、外鍵被刪後重跑會補回、我們表上有同名但不是外鍵的限制就拒絕、沒有 auth.users 就拒絕）
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIG = process.env.DONATE_MIG_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations"); // 對照修正前的版本用
const sql = (f: string) => readFileSync(path.join(MIG, f), "utf8");
const APPLY = "20261021_mahjong_donate.sql", ROLLBACK = "20261021_mahjong_donate_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Row = Record<string, unknown>;
async function setup() {
  const db = new PGlite();
  // Supabase 的角色與預設權限：新表、新函式預設會給 anon、authenticated（migration 要自己收回）
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table other_table (id int); insert into other_table values (1);
    create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');
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
/** public schema 的完整樣子（表、欄位、索引、限制、函式內容與權限、註解、policy、資料） */
async function snapshot(db: PGlite) {
  const q = async (s: string) => (await db.query<Row>(s)).rows;
  const data = async (t: string) => ((await q(`select to_regclass('public.${t}') is not null as x`))[0].x ? q(`select to_jsonb(r)::text j from public.${t} r order by 1`) : null);
  return {
    tables: await q(`select c.relname, c.relkind::text, c.relacl::text acl, c.relrowsecurity, obj_description(c.oid, 'pg_class') cmt
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','i','S') order by 1`),
    columns: await q("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, ordinal_position"),
    indexes: await q("select indexname, tablename, indexdef from pg_indexes where schemaname = 'public' order by 1"),
    constraints: await q("select conname, conrelid::regclass::text tbl, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1"),
    funcs: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc, p.proacl::text acl, obj_description(p.oid, 'pg_proc') cmt
      from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`),
    policies: await q("select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2"),
    data: [await data("other_table"), await data("mj_zimo_wins"), await data("mj_donate_acks")],
  };
}
const A = "aaaaaaaa-0000-4000-8000-000000000000", B = "bbbbbbbb-0000-4000-8000-000000000000";
const G = "99999999-0000-4000-8000-000000000000", NOBODY = "88888888-0000-4000-8000-000000000000";
const addUsers = (db: PGlite) => db.exec(`insert into auth.users values ('${A}', '{"provider":"line"}'), ('${B}', '{}'), ('${G}', '{"guest":true}')`);
/** 這張表上有沒有正確的外鍵：user_id → auth.users(id) on delete cascade */
const fkOk = async (db: PGlite, t: string) => (await db.query<Row>(`select count(*)::int n from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
  where c.conrelid = 'public.${t}'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'`)).rows[0].n === 1;
const R1 = "11111111-0000-4000-8000-000000000000", R2 = "22222222-0000-4000-8000-000000000000";
const T = (s: number) => new Date(Date.parse("2026-10-21T00:00:00Z") + s * 1000).toISOString();

{
  const db = await setup();
  await addUsers(db);
  const before = await snapshot(db);
  await db.exec(sql(APPLY));

  // Q1
  eq(await Promise.all([
    as(db, "anon", "select * from mj_zimo_wins"), as(db, "anon", "select * from mj_donate_acks"),
    as(db, "anon", `insert into mj_zimo_wins (room_id, hand_no, user_id) values ('${R1}', 1, '${A}')`),
    as(db, "anon", `insert into mj_donate_acks values ('${A}', now())`),
    as(db, "authenticated", "delete from mj_zimo_wins"), as(db, "authenticated", "update mj_donate_acks set acked_at = now()"),
    as(db, "anon", "truncate mj_zimo_wins"),
    as(db, "anon", `select public.mj_zimo_record('${R1}', 1, array['${A}']::uuid[])`),
    as(db, "authenticated", `select public.mj_donate_count('${A}')`),
    as(db, "anon", `select public.mj_donate_ack('${A}')`),
  ]), Array(10).fill("denied"), "Q1a anon、authenticated 讀寫清空兩張表、呼叫三個函式全部 permission denied");
  eq(await Promise.all([
    as(db, "service_role", `select public.mj_zimo_record('${R1}', 1, array['${A}']::uuid[])`),
    as(db, "service_role", `select public.mj_donate_count('${A}')`),
    as(db, "service_role", "select * from mj_zimo_wins"),
  ]), ["ok", "ok", "ok"], "Q1b service_role（伺服器）可以呼叫、可以讀");
  eq((await db.query<Row>("select count(*)::int n from pg_policies where tablename in ('mj_zimo_wins','mj_donate_acks')")).rows[0].n, 0, "Q1c 兩張表沒有任何 policy");

  // Q3
  await db.exec("delete from mj_zimo_wins; delete from mj_donate_acks;");
  const n = async (q: string) => Number(Object.values((await db.query<Row>(q)).rows[0])[0]);
  const rec = (room: string, hand: number, users: string[], s: number) => n(`select public.mj_zimo_record('${room}', ${hand}, array[${users.map((u) => `'${u}'`).join(",")}]::uuid[], '${T(s)}')`);
  const cnt = (u: string) => n(`select public.mj_donate_count('${u}')`);
  const ackAt = (u: string, s: number) => n(`select public.mj_donate_ack('${u}', '${T(s)}')`);
  eq([await cnt(A), await rec(R1, 1, [A], 1), await rec(R1, 1, [A], 2), await cnt(A), await cnt(B)], [0, 1, 0, 1, 0], "Q3a 沒紀錄是 0；記一筆 A 變 1；同一局重記回 0 筆、A 還是 1；B 是 0");
  eq([await rec(R1, 2, [A], 3), await rec(R2, 2, [A], 3), await cnt(A)], [1, 1, 3], "Q3b 同一房下一局、別房同一局號都各算一次：A 是 3");
  eq([await ackAt(A, 4), await ackAt(A, 4), await ackAt(A, 2), await cnt(A)], [0, 0, 0, 0], "Q3c 歸零回 0；連按、時間較早的歸零都不會讓舊的自摸跑回來");
  eq([await rec(R1, 3, [A, B], 5), await cnt(A), await cnt(B), await ackAt(B, 6), await cnt(A), await cnt(B)], [2, 1, 1, 0, 1, 0],
    "Q3d 歸零後 A 再自摸從 1 開始；B 各自累計、B 歸零不影響 A");
  eq(await rec(R2, 9, [], 7), 0, "Q3e 這局沒有自摸的人：不寫入");

  // Q4
  const dataBefore = (await snapshot(db)).data;
  await db.exec(sql(APPLY));
  eq([JSON.stringify((await snapshot(db)).data) === JSON.stringify(dataBefore), await as(db, "anon", "select * from mj_zimo_wins")], [true, "denied"], "Q4a 重跑不出錯、資料不重設、權限仍然鎖著");
  await db.exec(sql(ROLLBACK));
  eq(JSON.stringify(await snapshot(db)) === JSON.stringify(before), true, "Q4b 回滾後 public schema（表、欄位、索引、函式、權限、policy、其他資料）和套用前完全一致");
  eq([await tryExec(db, ROLLBACK), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], ["ok", true], "Q4c 回滾重跑不出錯、狀態不變");
}

// Q2 自我檢查
{
  const db = await setup();
  await db.exec(sql(APPLY));
  await db.exec(`
    create role other_owner nologin; grant usage on schema public to other_owner;
    grant select on public.mj_donate_acks to other_owner with grant option;
    set role other_owner; grant select on public.mj_donate_acks to anon; reset role;
  `);
  const before = await snapshot(db);
  const err = await tryExec(db, APPLY);
  eq([err.includes("鎖權限沒有完成"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true], "Q2 權限收不乾淨（別的 grantor 給的）→ 自我檢查丟錯，整份不生效，狀態不變");
}

// Q5～Q7 既有同名物件（沒有 anon 權限）
const PRE: [string, string, string, boolean][] = [
  ["Q5 同名的表", "mj_zimo_wins", `create table public.mj_zimo_wins (id serial primary key, note text); revoke all on public.mj_zimo_wins from anon, authenticated;
    insert into public.mj_zimo_wins (note) values ('別人的資料');`, true],
  ["Q6 同名的函式", "mj_donate_count", `create function public.mj_donate_count(p_user_id uuid) returns int language sql as $$ select 42 $$;
    revoke all on function public.mj_donate_count(uuid) from public, anon, authenticated;`, true],
  ["Q7 同名的索引", "mj_zimo_wins_user", `create table public.other_log (u uuid); revoke all on public.other_log from anon, authenticated;
    create index mj_zimo_wins_user on public.other_log (u);`, false],
];
for (const [label, name, ddl, rollbackRefuses] of PRE) {
  const db = await setup();
  await db.exec(ddl);
  const before = await snapshot(db);
  const applied = await tryExec(db, APPLY);
  eq([applied.includes("拒絕套用") && applied.includes(name), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    `${label}（沒有 anon 權限）：套用 → 明確拒絕，狀態完全不變`);
  const rolled = await tryExec(db, ROLLBACK);
  eq([rollbackRefuses ? rolled.includes("拒絕回滾") : rolled === "ok", JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    `${label}：直接跑回滾 → ${rollbackRefuses ? "明確拒絕" : "沒有這份建的東西，什麼都不做"}，別人的物件沒被刪，狀態完全不變`);
}

// Q8 遊客、不存在的帳號不記
{
  const db = await setup(); await addUsers(db); await db.exec(sql(APPLY));
  let n: number | string;
  try { n = Number((await db.query<Row>(`select public.mj_zimo_record('${R1}', 1, array['${A}', '${G}', '${NOBODY}', '${A}']::uuid[]) as n`)).rows[0].n); }
  catch (e) { n = "ERR " + (e as Error).message.slice(0, 60); }
  const rows = (await db.query<Row>("select user_id from mj_zimo_wins order by 1")).rows.map((r) => r.user_id);
  eq([n, rows], [1, [A]], "Q8 同一局記 A、遊客、不存在的帳號（A 重複兩次）：只寫入 A 一筆；遊客和不存在的帳號都沒寫入，也不會讓整筆失敗");
}
// Q9 外鍵存在、刪帳號連帶刪除
{
  const db = await setup(); await addUsers(db); await db.exec(sql(APPLY));
  await db.query(`select public.mj_zimo_record('${R1}', 1, array['${A}', '${B}']::uuid[])`);
  await db.query(`select public.mj_donate_ack('${A}')`); await db.query(`select public.mj_donate_ack('${B}')`);
  await db.query(`delete from auth.users where id = '${A}'`);
  const left = (await db.query<Row>("select (select array_agg(user_id::text) from mj_zimo_wins) w, (select array_agg(user_id::text) from mj_donate_acks) a")).rows[0];
  eq([await fkOk(db, "mj_zimo_wins"), await fkOk(db, "mj_donate_acks"), left], [true, true, { w: [B], a: [B] }], "Q9 兩張表都有 user_id → auth.users on delete cascade；刪掉 A，A 在兩張表的資料都跟著刪，B 不動");
}
// Q10 別的表剛好有同名的限制：照樣建好我們的外鍵（舊寫法只看名稱，會誤以為已經建好而跳過）
{
  const db = await setup();
  await db.exec(`create table public.someone_else (user_id uuid constraint mj_zimo_wins_user_id_fkey references auth.users (id), x uuid constraint mj_donate_acks_user_id_fkey references auth.users (id));
    revoke all on public.someone_else from anon, authenticated;`);
  const applied = await tryExec(db, APPLY);
  eq([applied, await fkOk(db, "mj_zimo_wins"), await fkOk(db, "mj_donate_acks")], ["ok", true, true], "Q10 別的表上有同名的限制：兩張表的外鍵照樣建好");
}
// Q11 外鍵被刪掉後重跑：補回來；我們表上有同名但不是外鍵的限制：拒絕、狀態不變
{
  const db = await setup(); await db.exec(sql(APPLY));
  await db.exec("alter table mj_zimo_wins drop constraint mj_zimo_wins_user_id_fkey");
  const re = await tryExec(db, APPLY);
  eq([re, await fkOk(db, "mj_zimo_wins")], ["ok", true], "Q11a 外鍵被刪掉後重跑 migration：補回來");
  await db.exec("alter table mj_donate_acks drop constraint mj_donate_acks_user_id_fkey; alter table mj_donate_acks add constraint mj_donate_acks_user_id_fkey check (user_id is not null);");
  const before = await snapshot(db);
  const bad = await tryExec(db, APPLY);
  eq([bad.includes("拒絕套用") && bad.includes("mj_donate_acks_user_id_fkey"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    "Q11b 我們表上有同名、但不是外鍵的限制：拒絕套用，狀態不變");
}
// Q12 沒有 auth.users：拒絕、什麼都不建（不會默默跳過外鍵）
{
  const db = await setup(); await db.exec("drop table auth.users");
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("找不到 auth.users"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true], "Q12 沒有 auth.users：拒絕套用，什麼都沒建");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

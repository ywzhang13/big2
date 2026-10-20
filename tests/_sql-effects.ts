// 在記憶體 PostgreSQL（PGlite）跑 20261021_mahjong_effects.sql 和回滾，驗證：
//   Q1 公開金鑰（anon、authenticated）讀、寫、清空冷卻表，呼叫冷卻函式，全部 permission denied；service_role 可以
//   Q2 自我檢查：權限沒收乾淨（模擬正式庫的預設權限被別的 grantor 補回）就整份不生效、什麼都沒建
//   Q3 冷卻函式：同組共用冷卻、跨組互不影響、重組接收保護、被擋下什麼都不寫、到時間放行、一天沒動的列自動清掉、組別和自己打自己被擋
//   Q4 重跑不出錯、不重設；回滾後表和函式都不見，和套用前的狀態一致，其他表不受影響
//   Q5～Q7 正式庫上本來就有同名的表／函式／索引（不是這份建的、也沒有給 anon 權限）：
//      套用 → 拒絕、狀態完全不變；回滾 → 拒絕、不會把別人的物件刪掉，狀態完全不變
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIG = process.env.EFFECTS_MIG_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations"); // 對照修正前的版本用
const sql = (f: string) => readFileSync(path.join(MIG, f), "utf8");
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
  `);
  return db;
}
async function as(db: PGlite, role: string, q: string): Promise<string> {
  await db.exec(`set role ${role}`);
  try { await db.query(q); return "ok"; } catch (e) { return (e as Error).message.includes("permission denied") ? "denied" : "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
/** public schema 的完整樣子：表（含註解、權限、RLS）、欄位、索引、函式（含內容、權限、註解）、policy、資料（比對前後用） */
async function snapshot(db: PGlite) {
  const q = async (s: string) => (await db.query<Row>(s)).rows;
  const hasRate = (await q("select to_regclass('public.mj_effect_rate') is not null as x"))[0].x;
  return {
    tables: await q(`select c.relname, c.relkind::text, c.relacl::text acl, c.relrowsecurity, obj_description(c.oid, 'pg_class') cmt
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','i','S') order by 1`),
    columns: await q(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, ordinal_position`),
    indexes: await q("select indexname, tablename, indexdef from pg_indexes where schemaname = 'public' order by 1"),
    constraints: await q("select conname, conrelid::regclass::text tbl, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1"),
    funcs: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc, p.proacl::text acl, obj_description(p.oid, 'pg_proc') cmt
      from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`),
    policies: await q("select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2"),
    data: await q("select id from other_table order by 1"),
    rate: hasRate ? await q("select to_jsonb(r)::text j from public.mj_effect_rate r order by 1") : null,
  };
}
async function tryExec(db: PGlite, file: string): Promise<string> {
  try { await db.exec(sql(file)); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return (e as Error).message; }
}
/** 呼叫冷卻函式：group light＝5 秒、無保護；heavy＝10 秒、保護 10 秒（和 rules.ts 一樣） */
const take = (from: string, to: string, group: string, now: string, room = "R") =>
  `select public.mj_effect_take('${room}', '${from}', '${to}', '${group}', ${group === "light" ? 5000 : 10000}, ${group === "light" ? 0 : 10000}, '${now}'::timestamptz) as w`;

{
  const db = await setup();
  const before = await snapshot(db);
  await db.exec(sql("20261021_mahjong_effects.sql"));

  // Q1
  const T0 = "2026-10-21T00:00:00Z";
  eq(await Promise.all([
    as(db, "anon", "select * from mj_effect_rate"),
    as(db, "anon", "insert into mj_effect_rate values ('R','u','heart', now())"),
    as(db, "anon", "update mj_effect_rate set last_at = now()"),
    as(db, "anon", "delete from mj_effect_rate"),
    as(db, "anon", "truncate mj_effect_rate"),
    as(db, "authenticated", "select * from mj_effect_rate"),
    as(db, "authenticated", "delete from mj_effect_rate"),
    as(db, "anon", take("a", "b", "light", T0)),
    as(db, "authenticated", take("a", "b", "heavy", T0)),
  ]), Array(9).fill("denied"), "Q1a anon、authenticated 讀、新增、修改、刪除、清空冷卻表，呼叫冷卻函式，全部 permission denied");
  eq([await as(db, "service_role", take("a", "b", "light", T0)), await as(db, "service_role", "select * from mj_effect_rate")], ["ok", "ok"], "Q1b service_role（伺服器）可以呼叫、可以讀");
  eq((await db.query<Row>("select count(*)::int n from pg_policies where tablename = 'mj_effect_rate'")).rows[0].n, 0, "Q1c 表上沒有任何 policy");

  // Q3
  await db.exec("delete from mj_effect_rate");
  const w = async (from: string, to: string, group: string, sec: number, room = "R") => {
    const r = (await db.query<{ w: { ok: boolean; reason?: string; retry_after_ms?: number } }>(take(from, to, group, new Date(Date.parse(T0) + sec * 1000).toISOString(), room))).rows[0].w;
    return r.ok ? "ok" : `${r.reason}:${r.retry_after_ms}`;
  };
  /** 整張表的完整資料列（所有房、所有欄位，last_at 精確到微秒），用來比對被擋前後 */
  const full = async () => (await db.query<{ j: string }>("select to_jsonb(r)::text j from mj_effect_rate r order by 1")).rows.map((r) => r.j);
  const blockedKeepsTable = async (from: string, to: string, group: string, sec: number) => {
    const before = await full();
    const res = await w(from, to, group, sec);
    return [res, JSON.stringify(await full()) === JSON.stringify(before)];
  };
  eq([await w("a", "b", "light", 0), await w("a", "c", "light", 2.5), await w("a", "c", "light", 4.9995), await w("a", "c", "light", 5)],
    ["ok", "cooldown:2500", "cooldown:1", "ok"], "Q3a 輕組 5 秒（換目標也共用）：2.5 秒還要 2500ms、快到時至少回 1ms、5 秒放行；沒有接收保護");
  await db.exec("delete from mj_effect_rate");
  eq([await w("a", "b", "heavy", 0), await w("a", "c", "light", 3)], ["ok", "ok"], "Q3b a 用重組打 b、3 秒後送輕組給 c：都成功（兩組互不影響）");
  const afterOk = await full();
  eq([
    await blockedKeepsTable("a", "c", "heavy", 3), // a 自己重組冷卻中
    await blockedKeepsTable("a", "d", "light", 4), // a 自己輕組冷卻中
    await blockedKeepsTable("c", "b", "heavy", 3), // b 在保護期（c 從沒送過）
    await blockedKeepsTable("d", "b", "heavy", 9.5), // b 在保護期（d 從沒送過）
  ], [["cooldown:7000", true], ["cooldown:4000", true], ["target_protected:7000", true], ["target_protected:500", true]],
    "Q3c 被擋下的完全不寫入：每一次被擋前後，整張表的完整資料列都相同（不新增列、不更新時間）");
  eq([JSON.stringify(await full()) === JSON.stringify(afterOk), (await full()).length], [true, 3],
    "Q3c' 四次被擋之後，整張表仍然只有成功那兩次留下的 3 列（a 的重組、a 的輕組、b 的保護期）");
  eq([await w("c", "b", "heavy", 10), await w("d", "b", "heavy", 10), await w("d", "c", "heavy", 10)], ["ok", "target_protected:10000", "ok"],
    "Q3d 第 10 秒 b 的保護期結束（被擋的嘗試沒有刷新）：c 打中 b，b 進入新的保護期，d 改打 c 照常");
  eq([await w("a", "b", "heavy", 0, "R2"), await w("b", "a", "heavy", 0, "R2")], ["ok", "ok"], "Q3e 別房分開算；互打（a 打 b、b 打 a）各自成功");
  await db.query(take("z", "y", "heavy", "2026-10-19T00:00:00Z", "OLD"));
  await w("a", "e", "light", 30);
  eq((await db.query<Row>("select count(*)::int n from mj_effect_rate where room_id = 'OLD'")).rows[0].n, 0, "Q3f 一天以上沒動的列自動清掉");
  eq([(await as(db, "service_role", take("a", "b", "medium", T0))).includes("未知的組別"), (await as(db, "service_role", take("a", "a", "heavy", T0))).includes("同一人")],
    [true, true], "Q3g 未知組別、自己打自己在資料庫也擋下");
  eq((await as(db, "service_role", "insert into mj_effect_rate values ('R', 'x', 'send_bomb', now())")).includes("check"), true, "Q3h 未知位子寫不進去（check 限制）");

  // Q4
  const rowsBefore = (await db.query<Row>("select count(*)::int n from mj_effect_rate")).rows[0].n;
  await db.exec(sql("20261021_mahjong_effects.sql"));
  eq([(await db.query<Row>("select count(*)::int n from mj_effect_rate")).rows[0].n, await as(db, "anon", "select * from mj_effect_rate")], [rowsBefore, "denied"], "Q4a 重跑不出錯、資料不重設、權限仍然鎖著");
  await db.exec(sql("20261021_mahjong_effects_rollback.sql"));
  eq(await snapshot(db), before, "Q4b 回滾後 public schema（表、函式、權限、policy、其他資料）和套用前完全一致");
}

// Q2 自我檢查：套用之後，有別的角色（grantor）把 anon 的權限給回去 → 重跑時 REVOKE 收不掉 → 整份不生效、狀態不變
{
  const db = await setup();
  await db.exec(sql("20261021_mahjong_effects.sql"));
  await db.exec(`
    create role other_owner nologin; grant usage on schema public to other_owner;
    grant select on public.mj_effect_rate to other_owner with grant option;
    set role other_owner; grant select on public.mj_effect_rate to anon; reset role;
  `);
  const before = await snapshot(db);
  const err = await tryExec(db, "20261021_mahjong_effects.sql");
  eq([err.includes("鎖權限沒有完成"), JSON.stringify(await snapshot(db)) === JSON.stringify(before)], [true, true],
    "Q2 權限收不乾淨（別的 grantor 給的）→ 自我檢查丟錯，整份不生效，狀態和重跑前一樣");
}

// Q5～Q7 正式庫上本來就有同名物件（不是這份 migration 建的，也沒有給 anon 任何權限）
const PRE: [string, string, string][] = [
  ["Q5 同名的表", "mj_effect_rate", `
    create table public.mj_effect_rate (id serial primary key, note text not null);
    revoke all on public.mj_effect_rate from anon, authenticated;
    insert into public.mj_effect_rate (note) values ('別人的資料'), ('不能被刪');`],
  ["Q6 同名的函式", "mj_effect_take", `
    create function public.mj_effect_take(p_room_id text, p_user_id text, p_kind text, p_cooldown_ms int, p_now timestamptz default null)
      returns int language sql as $$ select 42 $$;
    revoke all on function public.mj_effect_take(text, text, text, int, timestamptz) from public, anon, authenticated;`],
  ["Q7 同名的索引", "mj_effect_rate_last_at", `
    create table public.other_log (at timestamptz); revoke all on public.other_log from anon, authenticated;
    create index mj_effect_rate_last_at on public.other_log (at);`],
];
for (const [label, name, ddl] of PRE) {
  const db = await setup();
  await db.exec(ddl);
  const before = await snapshot(db);
  const applied = await tryExec(db, "20261021_mahjong_effects.sql");
  const afterApply = await snapshot(db);
  eq([applied.includes("拒絕套用") && applied.includes(name), JSON.stringify(afterApply) === JSON.stringify(before)], [true, true],
    `${label}（沒有 anon 權限）：套用 → 明確拒絕，狀態完全不變（表、欄位、索引、函式內容、權限、註解、資料）`);
  const rolled = await tryExec(db, "20261021_mahjong_effects_rollback.sql");
  const afterRollback = await snapshot(db);
  eq([name === "mj_effect_rate_last_at" ? rolled === "ok" : rolled.includes("拒絕回滾"), JSON.stringify(afterRollback) === JSON.stringify(before)], [true, true],
    `${label}：直接跑回滾 → ${name === "mj_effect_rate_last_at" ? "沒有這份建的東西，什麼都不做" : "明確拒絕"}，別人的物件沒被刪，狀態完全不變`);
}

// Q8 回滾可以重跑：已經回滾過（物件不存在）再跑一次，不出錯、狀態不變
{
  const db = await setup();
  const before = await snapshot(db);
  await db.exec(sql("20261021_mahjong_effects.sql"));
  await db.exec(sql("20261021_mahjong_effects_rollback.sql"));
  const again = await tryExec(db, "20261021_mahjong_effects_rollback.sql");
  eq([again, JSON.stringify(await snapshot(db)) === JSON.stringify(before)], ["ok", true], "Q8 回滾重跑：不出錯，和套用前一致");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

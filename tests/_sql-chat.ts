// 在記憶體 PostgreSQL（PGlite，模擬 Supabase 的角色、auth.users、storage）跑 20261023_mahjong_chat.sql 和回滾，驗證：
//   Q1 公開金鑰（anon、authenticated）讀寫冷卻表、呼叫冷卻函式全部 permission denied；service_role 可以；沒有 policy
//   Q2 語音 bucket mj-voice：私有、256KB、只收 audio/mp4
//   Q3 冷卻函式：只檢查（p_commit=false）不寫；擋下不寫；同一人同時兩則只放一則；別人、別房、別種不受影響；一天沒動的列清掉
//   Q4 偏好設定格式限制：v2、v3 都收；v3 帶 face、型別不對、少欄位、v1 不收；原本的 v2 資料不動
//   Q5 重跑不出錯、不重設；回滾：v3 轉回 v2、限制換回 20261022 的版本、表和函式刪掉、其他東西完全不變；回滾可以重跑；
//      bucket 要用腳本清（SQL 刪不了），沒清就重新套用會被拒絕，清了可以再套用
//   Q6 既有同名物件（不是這份建的）：表、主鍵索引、函式、mj-voice bucket、格式限制有別的標記、
//      格式限制沒標記但和 20261022 的正式 v2 定義不同（被手動改過）、格式限制不見了 → 套用拒絕、狀態不變；
//      回滾遇到別人的表、函式 → 拒絕、什麼都不刪
//   Q7 前提不成立：沒有 storage、沒有套 20261022 → 拒絕
//   Q8 自我檢查（Storage 權限，審伯退件 2）：公開金鑰可用、沒限定 bucket 或提到 mj-voice 的 storage.objects policy、
//      storage.objects 沒開 RLS、bucket 被改成公開 → 整份不生效、狀態不變
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS, SUPABASE_SETUP } from "./support/pg-mj";

const sql = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");
const PREFS = "20261022_mahjong_prefs.sql", APPLY = "20261023_mahjong_chat.sql", ROLLBACK = "20261023_mahjong_chat_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Row = Record<string, unknown>;
const A = "aaaaaaaa-0000-4000-8000-000000000000", B = "bbbbbbbb-0000-4000-8000-000000000000";
async function setup(withPrefs = true) {
  const db = new PGlite();
  await db.exec(SUPABASE_SETUP + `create table other_table (id int); insert into other_table values (1);
    insert into auth.users (id) values ('${A}'), ('${B}');`);
  if (withPrefs) await db.exec(sql(PREFS));
  return db;
}
async function as(db: PGlite, role: string, q: string): Promise<string> {
  await db.exec(`set role ${role}`);
  try { await db.query(q); return "ok"; } catch (e) { return (e as Error).message.includes("permission denied") ? "denied" : "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
async function tryExec(db: PGlite, file: string): Promise<string> {
  try { await db.exec(sql(file)); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return (e as Error).message; }
}
/** 整個資料庫看得到的樣子（表、欄位、索引、限制和註解、函式、權限、policy、bucket、資料） */
async function snapshot(db: PGlite) {
  const q = async (s: string) => (await db.query<Row>(s)).rows;
  const data = async (t: string) => ((await q(`select to_regclass('${t}') is not null as x`))[0].x ? q(`select to_jsonb(r)::text j from ${t} r order by 1`) : null);
  return {
    tables: await q(`select c.relnamespace::regnamespace::text ns, c.relname, c.relkind::text, c.relacl::text acl, c.relrowsecurity, obj_description(c.oid, 'pg_class') cmt
      from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and c.relkind in ('r','i','S') order by 1, 2`),
    columns: await q("select table_schema, table_name, column_name, data_type from information_schema.columns where table_schema in ('public','storage') order by 1, 2, ordinal_position"),
    constraints: await q(`select conname, conrelid::regclass::text tbl, pg_get_constraintdef(oid) def, obj_description(oid, 'pg_constraint') cmt
      from pg_constraint where connamespace in ('public'::regnamespace, 'storage'::regnamespace) order by 1, 2`),
    functions: await q("select proname, proacl::text acl, obj_description(oid, 'pg_proc') cmt, md5(prosrc) src from pg_proc where pronamespace = 'public'::regnamespace order by 1"),
    policies: await q("select schemaname, tablename, policyname from pg_policies order by 1, 2, 3"),
    data: [await data("public.other_table"), await data("public.mj_user_prefs"), await data("public.mj_chat_rate"), await data("storage.buckets")],
  };
}
const same = async (db: PGlite, before: unknown) => JSON.stringify(await snapshot(db)) === JSON.stringify(before);
const take = (room: string, user: string, kind: string, now: string, commit = true) =>
  `select public.mj_chat_take('${room}', '${user}', '${kind}', 2000, 5, 15000, 15000, ${commit}, '${now}'::timestamptz) as w`;
const T = (s: number) => new Date(Date.parse("2026-10-23T00:00:00Z") + s * 1000).toISOString();
const V2 = `'{"v":2,"back":"sakura","felt":"night"}'`;
const V3 = `'{"v":3,"back":"sakura","felt":"night","autoVoice":true,"voiceVol":"mid"}'`;

{
  const db = await setup();
  await db.exec(`insert into mj_user_prefs (user_id, prefs) values ('${B}', ${V2})`); // 上線前存的 v2
  const before = await snapshot(db);
  await db.exec(sql(APPLY));
  const w = async (q: string) => Number((await db.query<Row>(q)).rows[0].w);

  // Q1
  eq(await Promise.all([
    as(db, "anon", "select * from mj_chat_rate"),
    as(db, "anon", "insert into mj_chat_rate values ('R', 'u', 'text', '{}', now())"),
    as(db, "authenticated", "update mj_chat_rate set kind = 'voice'"),
    as(db, "authenticated", "delete from mj_chat_rate"),
    as(db, "anon", "truncate mj_chat_rate"),
    as(db, "anon", take("R", "u", "text", T(0))),
    as(db, "authenticated", take("R", "u", "text", T(0))),
  ]), Array(7).fill("denied"), "Q1a anon、authenticated 讀、新增、修改、刪除、清空冷卻表、呼叫冷卻函式全部 permission denied");
  eq([await as(db, "service_role", take("R", "u", "text", T(0))), await as(db, "service_role", "select * from mj_chat_rate")], ["ok", "ok"], "Q1b service_role（伺服器）可以");
  eq((await db.query<Row>("select count(*)::int n from pg_policies where tablename = 'mj_chat_rate'")).rows[0].n, 0, "Q1c 冷卻表沒有任何 policy");

  // Q2
  eq((await db.query<Row>("select id, public, file_size_limit::int, allowed_mime_types from storage.buckets")).rows,
    [{ id: "mj-voice", public: false, file_size_limit: 262144, allowed_mime_types: ["audio/mp4"] }], "Q2 語音 bucket mj-voice：私有、256KB、只收 audio/mp4");

  // Q3
  await db.exec("delete from mj_chat_rate");
  const peek = await w(take("R", "a", "voice", T(0), false));
  const n0 = (await db.query<Row>("select count(*)::int n from mj_chat_rate")).rows[0].n;
  eq([peek, n0], [0, 0], "Q3a 只檢查（p_commit=false）：回 0，表裡什麼都沒寫");
  await w(take("R", "a", "text", T(0)));
  const rowBefore = (await db.query<Row>("select sent_at::text, last_at::text from mj_chat_rate")).rows;
  const blocked = await w(take("R", "a", "text", T(1)));
  eq([blocked, JSON.stringify((await db.query<Row>("select sent_at::text, last_at::text from mj_chat_rate")).rows) === JSON.stringify(rowBefore)], [1000, true],
    "Q3b 1 秒後再送：回還要 1000ms，表完全沒變（擋下不寫）");
  const both = await Promise.all([w(take("R", "c", "text", T(0))), w(take("R", "c", "text", T(0)))]);
  eq(both.sort((x, y) => x - y), [0, 2000], "Q3c 同一人同時送兩則：只放一則，另一則要等 2 秒");
  eq([await w(take("R", "b", "text", T(1))), await w(take("R2", "a", "text", T(1))), await w(take("R", "a", "voice", T(1)))], [0, 0, 0], "Q3d 別人、別房、別種（語音）不受影響");
  await w(take("OLD", "z", "voice", "2026-10-21T00:00:00Z"));
  await w(take("R", "d", "voice", T(10)));
  eq((await db.query<Row>("select count(*)::int n from mj_chat_rate where room_id = 'OLD'")).rows[0].n, 0, "Q3e 一天以上沒動的冷卻紀錄自動清掉");

  // Q4
  const ins = async (prefs: string) => { const r = await as(db, "service_role", `insert into mj_user_prefs (user_id, prefs) values ('${A}', '${prefs}') on conflict (user_id) do update set prefs = excluded.prefs`); return r === "ok" ? "ok" : r.includes("check") ? "check" : r; };
  eq(await Promise.all([
    ins('{"v":3,"back":"sakura","felt":"night","autoVoice":false,"voiceVol":"high"}'),
    ins('{"v":2,"back":"jade","felt":"green"}'),
  ]), ["ok", "ok"], "Q4a v3（加 autoVoice、voiceVol）和 v2 都收");
  const bad = [];
  for (const p of [
    '{"v":3,"back":"sakura","felt":"night","autoVoice":true,"voiceVol":"mid","face":"ivory"}',
    '{"v":3,"back":"sakura","felt":"night","autoVoice":"yes","voiceVol":"mid"}',
    '{"v":3,"back":"sakura","felt":"night","autoVoice":true,"voiceVol":70}',
    '{"v":3,"back":"sakura","felt":"night","autoVoice":true}',
    '{"v":2,"back":"sakura","felt":"night","autoVoice":true,"voiceVol":"mid"}',
    '{"v":1,"back":"sakura","face":"ivory","felt":"night"}',
    '[1,2]',
  ]) bad.push(await ins(p));
  eq([bad, (await db.query<Row>(`select prefs from mj_user_prefs where user_id = '${B}'`)).rows[0].prefs],
    [Array(7).fill("check"), { v: 2, back: "sakura", felt: "night" }],
    "Q4b v3 帶 face、autoVoice 不是布林、voiceVol 不是字串、少欄位、v2 混語音欄位、v1、陣列都被資料庫擋下；上線前存的 v2 資料不動");

  // Q5
  const dataBefore = (await snapshot(db)).data;
  await db.exec(sql(APPLY));
  eq([JSON.stringify((await snapshot(db)).data) === JSON.stringify(dataBefore), await as(db, "anon", "select * from mj_chat_rate")], [true, "denied"],
    "Q5a 重跑不出錯、資料不重設、權限仍然鎖著");
  await db.exec(`update mj_user_prefs set prefs = ${V3} where user_id = '${B}'`);
  await db.exec(sql(ROLLBACK));
  await db.exec("delete from storage.buckets where id = 'mj-voice'"); // 模擬 scripts/mj-voice-purge.ts（正式庫 SQL 刪不了，只能走 Storage API）
  const after = await snapshot(db);
  const prefsAfter = after.data[1] as Row[];
  eq([JSON.stringify({ ...after, data: [after.data[0], null, after.data[2], after.data[3]] }) === JSON.stringify({ ...before, data: [before.data[0], null, before.data[2], before.data[3]] }),
    prefsAfter.map((r) => JSON.parse(r.j as string).prefs)],
    [true, [{ v: 2, back: "jade", felt: "green" }, { v: 2, back: "sakura", felt: "night" }]],
    "Q5b 回滾＋清 bucket 後：表、欄位、限制（換回 20261022 的定義）、函式、權限、policy、bucket 都和套用前一樣；v3 的列轉回 v2（只留牌背、桌布）");
  eq([await tryExec(db, ROLLBACK), await same(db, after)], ["ok", true], "Q5c 回滾重跑不出錯、狀態不變");
  eq(await tryExec(db, APPLY), "ok", "Q5d 清掉 bucket 之後可以再套用");
  await db.exec(sql(ROLLBACK));
  const r = await tryExec(db, APPLY);
  eq([r.includes("拒絕套用") && r.includes("mj-voice")], [true], "Q5e 回滾後沒清 bucket 就重新套用：明確拒絕（要先跑清除腳本）");
}

// Q6 既有同名物件
for (const [label, name, ddl, rollbackRefuses] of [
  ["Q6a 同名的表", "mj_chat_rate", `create table public.mj_chat_rate (id int); revoke all on public.mj_chat_rate from anon, authenticated; insert into public.mj_chat_rate values (7);`, true],
  ["Q6b 同名的主鍵索引", "mj_chat_rate_pkey", `create table public.other_log (id int); revoke all on public.other_log from anon, authenticated; create index mj_chat_rate_pkey on public.other_log (id);`, false],
  ["Q6c 同名的函式", "mj_chat_take", `create function public.mj_chat_take() returns int language sql as 'select 1';`, true],
  ["Q6d 別人的 mj-voice bucket", "mj-voice", `insert into storage.buckets (id, name, public) values ('mj-voice', 'mj-voice', true);`, false],
  ["Q6e 格式限制有別的標記", "mj_user_prefs_prefs_check", `comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'someone:else';`, false],
  ["Q6f 格式限制沒有標記、但被改過（大小上限改成 2048）", "不是 20261022 的正式 v2 定義",
    `alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
     alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
       prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb
       and prefs -> 'v' = '2'::jsonb and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
       and pg_column_size(prefs) <= 2048 else false end);`, false],
  ["Q6g 格式限制沒有標記、被換成很寬的（只要是物件）", "不是 20261022 的正式 v2 定義",
    `alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
     alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check check (jsonb_typeof(prefs) = 'object');`, false],
  ["Q6h 格式限制不見了", "mj_user_prefs_prefs_check", `alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;`, false],
] as [string, string, string, boolean][]) {
  const db = await setup();
  await db.exec(ddl);
  const before = await snapshot(db);
  const applied = await tryExec(db, APPLY);
  eq([applied.includes("拒絕套用") && applied.includes(name), await same(db, before)], [true, true], `${label}：套用 → 明確拒絕，狀態完全不變`);
  const rolled = await tryExec(db, ROLLBACK);
  eq([rollbackRefuses ? rolled.includes("拒絕回滾") : rolled === "ok", await same(db, before)], [true, true],
    `${label}：直接跑回滾 → ${rollbackRefuses ? "明確拒絕" : "沒有這份建的東西，什麼都不做"}，別人的物件沒被刪，狀態完全不變`);
}

// Q7 前提
{
  const db = await setup();
  await db.exec("drop table storage.objects; drop table storage.buckets;");
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("找不到 storage"), await same(db, before)], [true, true], "Q7a 沒有 Supabase Storage：拒絕套用，什麼都沒建");
}
{
  const db = await setup(false);
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("拒絕套用") && r.includes("20261022"), await same(db, before)], [true, true], "Q7b 還沒套用 20261022（沒有 mj_user_prefs）：拒絕套用，什麼都沒建");
}

// Q8 自我檢查（Storage 權限）
for (const [label, ddl] of [
  ["Q8a anon 能讀所有 bucket 的 policy（沒限定 bucket_id）", `create policy "all read" on storage.objects for select to anon using (true);`],
  ["Q8b authenticated 能讀 mj-voice 的 policy", `create policy "voice read" on storage.objects for select to authenticated using (bucket_id = 'mj-voice');`],
  ["Q8c public 能寫、沒限定 bucket 的 policy", `create policy "all write" on storage.objects for insert to public with check (name is not null);`],
  ["Q8d storage.objects 沒開 RLS", `alter table storage.objects disable row level security;`],
] as [string, string][]) {
  const db = await setup();
  await db.exec(ddl);
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("整份不生效"), await same(db, before)], [true, true], `${label}：自我檢查丟錯，整份不生效、狀態不變`);
}
{
  const db = await setup();
  await db.exec(`create policy "avatars read" on storage.objects for select to anon using (bucket_id = 'avatars');`);
  eq(await tryExec(db, APPLY), "ok", "Q8e 只開放別的 bucket（限定 bucket_id = 'avatars'）的 policy：不影響，照常套用");
}
{
  // bucket 在 migration 跑到一半被別人改成公開（模擬：先建好、再用 trigger 在 upsert 後改回公開）
  const db = await setup();
  await db.exec(`create function public.evil() returns trigger language plpgsql as $$ begin new.public := true; return new; end $$;
    create trigger evil before insert or update on storage.buckets for each row execute function public.evil();`);
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("mj-voice 設定不對"), await same(db, before)], [true, true], "Q8f bucket 最後不是私有：自我檢查丟錯，整份不生效、狀態不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

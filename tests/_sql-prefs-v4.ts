// 在記憶體 PostgreSQL（PGlite，模擬 Supabase 的角色、auth.users）跑 20261024_mahjong_prefs_v4.sql 和回滾，驗證：
//   V1 格式限制：v4 收（音量 0、100 邊界）；v2、v3 照收；之前存的 v2、v3 資料不動
//   V2 v4 擋：音量超出 0～100、小數、字串、null，開關不是布林，少欄位、多欄位（face、muted），v 不對
//   V3 公開金鑰（anon、authenticated）仍然讀寫不到偏好設定
//   V4 重跑不出錯、資料不動；回滾：v4 轉回 v3（音量換回最接近的三段）、限制換回 20261023 的定義和標記，其他完全不變；
//      回滾可以重跑；回滾後 20261023 的回滾照樣能用；回滾後可以再套用
//   V5 前提不成立／既有限制不是 20261023 換上的：沒套 20261023（還是 v2 限制）、別的標記、沒有標記、
//      有 20261023 標記但定義被改過、限制不見了、沒有 mj_user_prefs → 拒絕套用、狀態不變；這些情況直接跑回滾 → 什麼都不動
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS, SUPABASE_SETUP } from "./support/pg-mj";

const sql = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");
const PREFS = "20261022_mahjong_prefs.sql", CHAT = "20261023_mahjong_chat.sql", CHAT_RB = "20261023_mahjong_chat_rollback.sql";
const APPLY = "20261024_mahjong_prefs_v4.sql", ROLLBACK = "20261024_mahjong_prefs_v4_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Row = Record<string, unknown>;
const A = "aaaaaaaa-0000-4000-8000-000000000000", B = "bbbbbbbb-0000-4000-8000-000000000000", C = "cccccccc-0000-4000-8000-000000000000";
async function setup(upTo: "none" | "prefs" | "chat" = "chat") {
  const db = new PGlite();
  await db.exec(SUPABASE_SETUP + `create table other_table (id int); insert into other_table values (1);
    insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');`);
  if (upTo !== "none") await db.exec(sql(PREFS));
  if (upTo === "chat") await db.exec(sql(CHAT));
  return db;
}
async function tryExec(db: PGlite, file: string): Promise<string> {
  try { await db.exec(sql(file)); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return (e as Error).message; }
}
async function as(db: PGlite, role: string, q: string): Promise<string> {
  await db.exec(`set role ${role}`);
  try { await db.query(q); return "ok"; } catch (e) { return (e as Error).message.includes("permission denied") ? "denied" : "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
/** 表、欄位、限制和註解、函式、權限、policy、資料 */
async function snapshot(db: PGlite) {
  const q = async (s: string) => (await db.query<Row>(s)).rows;
  const data = async (t: string) => ((await q(`select to_regclass('${t}') is not null as x`))[0].x ? q(`select user_id::text u, prefs::text p from ${t} order by 1`) : null);
  return {
    tables: await q(`select c.relname, c.relkind::text, c.relacl::text acl, c.relrowsecurity, obj_description(c.oid, 'pg_class') cmt
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','i','S') order by 1`),
    columns: await q("select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by 1, ordinal_position"),
    constraints: await q(`select conname, conrelid::regclass::text tbl, pg_get_constraintdef(oid) def, obj_description(oid, 'pg_constraint') cmt
      from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
    functions: await q("select proname, proacl::text acl, md5(prosrc) src from pg_proc where pronamespace = 'public'::regnamespace order by 1"),
    policies: await q("select schemaname, tablename, policyname from pg_policies order by 1, 2, 3"),
    data: [await q("select id from other_table"), await data("public.mj_user_prefs")],
  };
}
const same = async (db: PGlite, before: unknown) => JSON.stringify(await snapshot(db)) === JSON.stringify(before);
const sorted = (o: unknown) => Object.fromEntries(Object.entries(o as object).sort(([x], [y]) => x.localeCompare(y))); // jsonb 會重排鍵的順序
const prefsOf = async (db: PGlite) => (await db.query<{ u: string; p: unknown }>("select user_id::text u, prefs p from mj_user_prefs order by 1")).rows.map((r) => sorted(r.p));
const V4 = (o: Record<string, unknown> = {}) => JSON.stringify({ v: 4, back: "sakura", felt: "night", voiceVol: 70, voiceMuted: false, fxVol: 70, fxMuted: false, autoVoice: true, ...o });
const V3 = (voiceVol = "mid") => JSON.stringify({ v: 3, back: "ink", felt: "wine", autoVoice: false, voiceVol });
const V2 = JSON.stringify({ v: 2, back: "coral", felt: "black" });
const ins = async (db: PGlite, prefs: string) => {
  try { await db.query("insert into mj_user_prefs (user_id, prefs) values ($1, $2) on conflict (user_id) do update set prefs = excluded.prefs", [A, prefs]); return "ok"; }
  catch (e) { return (e as Error).message.includes("check") ? "check" : (e as Error).message; }
};

{
  const db = await setup();
  await db.query("insert into mj_user_prefs (user_id, prefs) values ($1, $2), ($3, $4)", [B, V2, C, V3("high")]); // 之前存的 v2、v3
  const before = await snapshot(db);
  await db.exec(sql(APPLY));

  // V1
  eq([await ins(db, V4()), await ins(db, V4({ voiceVol: 0, fxVol: 100, voiceMuted: true, fxMuted: true, autoVoice: false })), await ins(db, V3()), await ins(db, V2),
    (await prefsOf(db)).slice(1)], ["ok", "ok", "ok", "ok", [sorted(JSON.parse(V2)), sorted(JSON.parse(V3("high")))]],
    "V1 v4 收（音量 0、100 邊界、兩個靜音）；v3、v2 照收；之前存的 v2、v3 資料不動");
  // V2
  const bad = [V4({ voiceVol: 101 }), V4({ fxVol: -1 }), V4({ voiceVol: 70.5 }), V4({ fxVol: 0.5 }), V4({ fxVol: "70" }), V4({ voiceVol: null }),
    V4({ voiceMuted: "false" }), V4({ fxMuted: 0 }), V4({ autoVoice: null }), V4({ face: "ivory" }), V4({ muted: true }), V4({ v: 5 }),
    JSON.stringify({ v: 4, back: "sakura", felt: "night", voiceVol: 70, voiceMuted: false, fxVol: 70, autoVoice: true }),
    JSON.stringify({ v: 3, back: "ink", felt: "wine", autoVoice: false, voiceVol: 70 }), "[1]"];
  const badRes = []; for (const p of bad) badRes.push(await ins(db, p));
  eq(badRes, Array(bad.length).fill("check"), "V2 v4 音量 101／-1／70.5／0.5／字串／null、開關不是布林、多 face／muted、v 不對、少 fxMuted、v3 音量用數字、陣列都被資料庫擋下");
  // V3
  eq([await as(db, "anon", "select * from mj_user_prefs"), await as(db, "authenticated", `update mj_user_prefs set prefs = '${V2}'`)], ["denied", "denied"],
    "V3 公開金鑰仍然讀寫不到偏好設定");

  // V4
  await db.query("update mj_user_prefs set prefs = $1 where user_id = $2", [V4({ voiceVol: 52, voiceMuted: true }), A]);
  const mid = await snapshot(db);
  eq([await tryExec(db, APPLY), await same(db, mid)], ["ok", true], "V4a 重跑不出錯、資料和限制都不動");
  const conv = [];
  for (const v of [0, 52, 53, 84, 85, 100]) {
    await db.query("update mj_user_prefs set prefs = $1 where user_id = $2", [V4({ voiceVol: v, fxMuted: true }), A]);
    await db.exec(sql(ROLLBACK)); conv.push((await prefsOf(db))[0]); await db.exec(sql(APPLY));
  }
  eq(conv.map((p) => (p as Row).voiceVol), ["low", "low", "mid", "mid", "high", "high"], "V4b 回滾：語音音量 0、52→low，53、84→mid，85、100→high");
  await db.query("update mj_user_prefs set prefs = $1 where user_id = $2", [V4({ voiceVol: 30, voiceMuted: true, fxVol: 10, autoVoice: false, back: "jade", felt: "green" }), A]);
  await db.exec(sql(ROLLBACK));
  const after = await snapshot(db);
  eq([JSON.stringify({ ...after, data: null }) === JSON.stringify({ ...before, data: null }), await prefsOf(db)],
    [true, [sorted({ v: 3, back: "jade", felt: "green", autoVoice: false, voiceVol: "low" }), sorted(JSON.parse(V2)), sorted(JSON.parse(V3("high")))]],
    "V4c 回滾後：表、欄位、限制（20261023 的定義和標記）、函式、權限、policy 都和套用前一樣；v4 轉回 v3（靜音、互動音效丟掉，牌背、桌布、自動播放保留），v2、v3 不動");
  eq([await tryExec(db, ROLLBACK), await same(db, after)], ["ok", true], "V4d 回滾重跑不出錯、狀態不變");
  eq(await tryExec(db, APPLY), "ok", "V4e 回滾後可以再套用");
  await db.exec(sql(ROLLBACK));
  await db.exec(sql(CHAT_RB));
  eq(((await db.query<Row>(`select obj_description(oid, 'pg_constraint') c from pg_constraint where conname = 'mj_user_prefs_prefs_check'`)).rows[0].c), null,
    "V4f 回滾 v4 之後再回滾 20261023：照樣把限制換回 20261022 的版本（沒有標記）");
}

// V5 前提、既有限制不是 20261023 換上的
const CHAT_DEF = `check (case when jsonb_typeof(prefs) = 'object' then
  pg_column_size(prefs) <= 1024
  and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
  and (
    (prefs -> 'v' = '2'::jsonb and prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb)
    or (prefs -> 'v' = '3'::jsonb and prefs ?& array['v', 'back', 'felt', 'autoVoice', 'voiceVol']
        and prefs - array['v', 'back', 'felt', 'autoVoice', 'voiceVol'] = '{}'::jsonb
        and jsonb_typeof(prefs -> 'autoVoice') = 'boolean' and jsonb_typeof(prefs -> 'voiceVol') = 'string')
  )
else false end)`;
for (const [label, upTo, ddl, word] of [
  ["V5a 還沒套用 20261023（限制還是 20261022 的 v2）", "prefs", "", "沒有標記"],
  ["V5b 限制有別的標記", "chat", `comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'someone:else';`, "someone:else"],
  ["V5c 限制沒有標記（定義和 20261023 一樣）", "chat", `comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is null;`, "沒有標記"],
  ["V5d 有 20261023 標記但定義被改過（大小上限 2048）", "chat",
    `alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
     alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check ${CHAT_DEF.replace("<= 1024", "<= 2048")};
     comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'mj_chat:20261023';`, "定義和 20261023 不同"],
  ["V5e 限制不見了", "chat", `alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;`, "不見了"],
  ["V5f 沒有 mj_user_prefs", "none", "", "20261022"],
] as [string, "none" | "prefs" | "chat", string, string][]) {
  const db = await setup(upTo);
  if (ddl) await db.exec(ddl);
  const before = await snapshot(db);
  const r = await tryExec(db, APPLY);
  eq([r.includes("拒絕套用") && r.includes(word), await same(db, before)], [true, true], `${label}：套用 → 明確拒絕，狀態完全不變`);
  eq([await tryExec(db, ROLLBACK), await same(db, before)], ["ok", true], `${label}：直接跑回滾 → 不是這份換的限制，什麼都不動`);
}
// V5g 定義寫法和 20261023 逐字一樣才算：用 20261023 的寫法自己重建（標記也對）→ 照常套用
{
  const db = await setup();
  await db.exec(`alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
    alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check ${CHAT_DEF};
    comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'mj_chat:20261023';`);
  eq(await tryExec(db, APPLY), "ok", "V5g 限制是 20261023 的定義和標記（重建過也一樣）：照常套用");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

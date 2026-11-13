// 20261113_mahjong_chat_history.sql：權限、前提檢查、回滾（記憶體 PostgreSQL 跑真的 migration）
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS, SUPABASE_SETUP } from "./support/pg-mj";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const sql = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");
const fresh = async () => { const d = new PGlite(); await d.exec(SUPABASE_SETUP); await d.exec("create table public.mj_rooms (id text primary key)"); return d; };

// 前提：沒有 mj_rooms 就拒絕
{
  const d = new PGlite(); await d.exec(SUPABASE_SETUP);
  for (const f of ["20261022_mahjong_prefs.sql", "20261023_mahjong_chat.sql", "20261024_mahjong_prefs_v4.sql"]) await d.exec(sql(f));
  let err = "";
  try { await d.exec(sql("20261113_mahjong_chat_history.sql")); } catch (e) { err = (e as Error).message; await d.exec("rollback"); }
  eq(err.includes("mj_rooms"), true, "沒有 mj_rooms（判斷房間還在不在要用）就整份拒絕");
}
// 前提：沒有 20261023（mj_chat_take）就拒絕
{
  const d = await fresh();
  let err = "";
  try { await d.exec(sql("20261113_mahjong_chat_history.sql")); } catch (e) { err = (e as Error).message; await d.exec("rollback"); }
  eq([err.includes("20261023"), (await d.query("select to_regclass('public.mj_chat_messages') is null as gone")).rows[0]], [true, { gone: true }], "沒有先套 20261023（找不到 mj_chat_take）就整份拒絕、什麼都沒建");
}

const d = await fresh();
for (const f of ["20261022_mahjong_prefs.sql", "20261023_mahjong_chat.sql", "20261024_mahjong_prefs_v4.sql", "20261113_mahjong_chat_history.sql"]) await d.exec(sql(f));
await d.query("insert into mj_rooms (id) values ('R')");
await d.query("select mj_chat_post('R', 'u1', 'text', 2000, 5, 15000, 15000, '{\"id\":\"a\",\"kind\":\"text\",\"text\":\"hi\"}', 200)");

// 公開金鑰碰不到
const denied: string[] = [];
for (const role of ["anon", "authenticated"]) {
  for (const q of ["select * from mj_chat_messages", "delete from mj_chat_messages", "select * from mj_chat_history('R')",
    "select mj_chat_append('R', '{}', 10)", "select mj_chat_post('R', 'u', 'text', 1, 1, 1, 1, '{}', 10)", "select mj_chat_lock_room('R')"]) {
    try { await d.exec(`set role ${role}; ${q}; reset role;`); } catch { denied.push(role); }
    await d.exec("reset role;");
  }
}
eq(denied.length, 12, "anon、authenticated 讀表、刪表、呼叫 4 個函式全部被拒絕（12/12）");

// 重複套用拒絕
let again = "";
try { await d.exec(sql("20261113_mahjong_chat_history.sql")); } catch (e) { again = (e as Error).message; await d.exec("rollback"); }
eq(again.includes("已經存在"), true, "已經套用過再套一次：拒絕");

// 回滾：只刪這份的東西，冷卻表和 mj_chat_take 還在；之後可以再套
await d.exec(sql("20261113_mahjong_chat_history_rollback.sql"));
const left = (await d.query<{ t: boolean; f: number; rate: boolean; take: boolean }>(
  `select to_regclass('public.mj_chat_messages') is not null t,
          (select count(*)::int from pg_proc where proname in ('mj_chat_lock_room','mj_chat_append','mj_chat_post','mj_chat_history')) f,
          to_regclass('public.mj_chat_rate') is not null rate,
          to_regprocedure('public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)') is not null take`)).rows[0];
await d.exec(sql("20261113_mahjong_chat_history.sql"));
const back = (await d.query<{ f: number }>("select count(*)::int f from pg_proc where proname in ('mj_chat_lock_room','mj_chat_append','mj_chat_post','mj_chat_history')")).rows[0];
eq([left, back.f], [{ t: false, f: 0, rate: true, take: true }, 4], "回滾：聊天紀錄表和 4 個函式刪掉，20261023 的冷卻表和 mj_chat_take 保留；回滾後可以再套用");

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

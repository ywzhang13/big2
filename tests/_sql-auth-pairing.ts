// 在 PGlite（記憶體 Postgres）直接執行 20261019_auth_pairing.sql 和回滾：
// 只認領／只領取得到一次、過期清理、密鑰錯誤計數、只有 service role 能用（store.ts 的查詢條件照這裡寫）
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const results: string[] = [];
const eq = (a: unknown, e: unknown, msg: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
};
const db = new PGlite();
const rows = async (q: string, a?: unknown[]) => (await db.query<Record<string, unknown>>(q, a)).rows;
async function as<T>(role: string, fn: () => Promise<T>): Promise<T | string> {
  await db.exec(`set role ${role}`);
  try { return await fn(); } catch (e) { return "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
const run = (f: string) => db.exec(readFileSync(path.join(SUPA, f), "utf8"));
await run("20261019_auth_pairing.sql");

const ins = (code: string, expires = "now() + interval '3 minutes'") =>
  db.query(`insert into auth_pairings (code_hash, poll_hash, expires_at) values ($1, 'poll-' || $1, ${expires})`, [code]);
// store.markReady／takeReady 用的條件
const markReady = async (code: string, uid: string) =>
  (await rows(`update auth_pairings set status = 'ready', user_id = $2, payload = 'enc' where code_hash = $1 and status = 'pending' and expires_at > now() returning code_hash`, [code, uid])).length;
const takeReady = async (code: string, poll: string) =>
  (await rows(`delete from auth_pairings where code_hash = $1 and poll_hash = $2 and status = 'ready' and expires_at > now() returning payload`, [code, poll])).map((r) => r.payload);

await ins("c1");
const u1 = "11111111-1111-4111-8111-111111111111", u2 = "22222222-2222-4222-8222-222222222222";
eq([await markReady("c1", u1), await markReady("c1", u2), (await rows(`select user_id from auth_pairings where code_hash='c1'`))[0].user_id], [1, 0, u1],
  "Q1 認領：第一次成功、第二次（別的帳號）改不到，user_id 還是第一個人");
eq([await takeReady("c1", "wrong"), await takeReady("c1", "poll-c1"), await takeReady("c1", "poll-c1"), (await rows(`select count(*)::int c from auth_pairings`))[0].c],
  [[], ["enc"], [], 0], "Q2 領取：密鑰錯拿不到；對的拿到一次並整筆刪除，第二次拿不到");
await ins("c2", "now() - interval '1 second'");
eq([await markReady("c2", u1), await takeReady("c2", "poll-c2")], [0, []], "Q3 過期的配對：認領、領取都不會成功");
await db.query(`update auth_pairings set status='ready', payload='enc' where code_hash='c2'`);
await ins("c3");
await db.exec(`delete from auth_pairings where expires_at <= now()`);
eq((await rows(`select code_hash from auth_pairings order by 1`)).map((r) => r.code_hash), ["c3"], "Q4 清理：過期的（含已認領沒領走、有加密憑證的）刪掉，沒過期的留著");
const f = [];
for (let i = 0; i < 3; i++) f.push((await rows(`select auth_pairing_poll_fail('c3') as n`))[0].n);
eq([f, (await rows(`select auth_pairing_poll_fail('nope') as n`))[0].n], [[1, 2, 3], null], "Q5 密鑰錯誤計數一次加一；不存在的代碼回 null");
const bad = await as("service_role", async () => { await db.query(`update auth_pairings set status='used' where code_hash='c3'`); return "ok"; });
eq(typeof bad === "string" && bad.startsWith("ERR"), true, "Q6 status 只能是 pending／ready");
const anonRead = await as("anon", async () => (await rows(`select * from auth_pairings`)).length);
const anonFn = await as("anon", async () => rows(`select auth_pairing_poll_fail('c3')`));
const svc = await as("service_role", async () => (await rows(`select count(*)::int c from auth_pairings`))[0].c);
eq([anonRead === 0 || (typeof anonRead === "string" && anonRead.includes("permission denied")), typeof anonFn === "string" && anonFn.startsWith("ERR"), svc], [true, true, 1],
  "Q7 公開金鑰（anon）讀不到表、不能呼叫函式；service role 可以");
await run("20261019_auth_pairing_rollback.sql");
const left = ((await rows(`select count(*)::int c from pg_proc where proname = 'auth_pairing_poll_fail'`))[0].c as number)
  + ((await rows(`select count(*)::int c from information_schema.tables where table_name = 'auth_pairings'`))[0].c as number);
eq(left, 0, "Q8 回滾：表和函式都移除");
await run("20261019_auth_pairing.sql"); await run("20261019_auth_pairing.sql");
eq(true, true, "Q9 migration 可以重跑");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

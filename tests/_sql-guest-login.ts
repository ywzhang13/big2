// 在 PGlite（記憶體 Postgres）直接執行 20261018_guest_login.sql 和回滾：猜錯計數、鎖定、時間窗重算、只有 service role 能用
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
const one = async (q: string, a?: unknown[]) => (await db.query<Record<string, unknown>>(q, a)).rows[0];
async function as<T>(role: string, fn: () => Promise<T>): Promise<T | string> {
  await db.exec(`set role ${role}`);
  try { return await fn(); } catch (e) { return "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
const run = (f: string) => db.exec(readFileSync(path.join(SUPA, f), "utf8"));

await run("20261018_guest_login.sql");
const fail = async (key: string) => (await one(`select guest_login_fail($1, 5, 900, 900) as u`, [key])).u;
const locked = async (key: string) => (await one(`select guest_login_locked_until($1) as u`, [key])).u;
const four = [];
for (let i = 0; i < 4; i++) four.push(await fail("ip:1"));
const fifth = await fail("ip:1");
eq([four.every((x) => x === null), fifth !== null, (await locked("ip:1")) !== null, await locked("ip:2")], [true, true, true, null],
  "S1 同一個 key 前 4 次錯不鎖，第 5 次鎖；鎖住時查得到；別的 key 不受影響");
// 時間窗過了重算：把 window_start 改到 20 分鐘前
await fail("ip:3"); await fail("ip:3"); await fail("ip:3"); await fail("ip:3");
await db.exec(`update guest_login_attempts set window_start = now() - interval '20 minutes' where key = 'ip:3'`);
eq([await fail("ip:3"), (await one(`select failures from guest_login_attempts where key='ip:3'`)).failures], [null, 1], "S2 超過 15 分鐘的時間窗：重新從 1 開始算，不會因為舊的錯誤被鎖");
await db.exec(`update guest_login_attempts set locked_until = now() - interval '1 second' where key = 'ip:1'`);
eq(await locked("ip:1"), null, "S3 鎖定時間過了就解鎖");
const anonRead = await as("anon", async () => (await db.query(`select * from guest_login_attempts`)).rows.length);
const anonFn = await as("anon", async () => one(`select guest_login_fail('x', 5, 900, 900) as u`));
const svcFn = await as("service_role", async () => (await one(`select guest_login_locked_until('ip:1') as u`)).u);
eq([anonRead === 0 || (typeof anonRead === "string" && anonRead.includes("permission denied")), typeof anonFn === "string" && anonFn.startsWith("ERR"), svcFn], [true, true, null], "S4 公開金鑰（anon）讀不到紀錄、不能呼叫函式；service role 可以");
await run("20261018_guest_login_rollback.sql");
const left = ((await one(`select count(*)::int c from pg_proc where proname like 'guest_login_%'`)).c as number) + ((await one(`select count(*)::int c from information_schema.tables where table_name='guest_login_attempts'`)).c as number);
eq(left, 0,
  "S5 回滾：表和兩個函式都移除");
await run("20261018_guest_login.sql"); await run("20261018_guest_login.sql");
eq(true, true, "S6 migration 可以重跑");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

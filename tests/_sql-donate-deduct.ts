// 20261102_mahjong_donate_deduct.sql 在記憶體 PostgreSQL（PGlite）實際套用與回滾：
//   M1 套用前就有的歸零列和次數，套用後完全不變（只新增欄位、預設值不改次數）；重跑一次也不出錯、不改資料
//   M2 公開金鑰（anon、authenticated）不能執行任何一支新函式、也不能讀寫 mj_donate_acks
//   M3 前提沒套用（缺 20261031）整份拒絕、什麼都沒改
//   M4 回滾：新函式和欄位拿掉，mj_donation_add 改回「記一筆＝歸零」；已有 zimo_clear 紀錄時 action 檢查維持放寬；回滾可以重跑
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const read = (f: string) => readFileSync(path.join(MIG, f), "utf8");
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
async function base(withFx = true) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');`);
  await db.exec(read("20261021_mahjong_donate.sql"));
  if (withFx) { await db.exec(read("20261031_mahjong_zimo_fx.sql")); await db.exec(read("20261101_mahjong_golden_zimo.sql")); }
  return db;
}
const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";
const one = async (db: PGlite, q: string) => (await db.query<{ v: unknown }>(q)).rows[0]?.v;
const snapshot = async (db: PGlite) => JSON.stringify((await db.query("select user_id, acked_at from mj_donate_acks order by user_id")).rows)
  + JSON.stringify((await db.query("select count(*) from mj_zimo_wins")).rows);

// ---- M1 舊資料不變、可重跑 ----
{
  const db = await base();
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');
    insert into mj_zimo_wins values ('00000000-0000-4000-8000-000000000001', 1, '${A}', '2026-10-20T00:00:00Z'), ('00000000-0000-4000-8000-000000000002', 1, '${A}', '2026-10-25T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000003', 1, '${B}', '2026-10-25T00:00:00Z');
    insert into mj_donate_acks (user_id, acked_at) values ('${A}', '2026-10-22T00:00:00Z');`);
  const before = [await snapshot(db), await one(db, `select public.mj_donate_count('${A}') v`), await one(db, `select public.mj_donate_count('${B}') v`)];
  await db.exec(read("20261102_mahjong_donate_deduct.sql"));
  const after = [await snapshot(db), await one(db, `select public.mj_donate_count('${A}') v`), await one(db, `select public.mj_donate_count('${B}') v`)];
  const cols = (await db.query<{ c: string; d: string | null }>("select column_name c, column_default d from information_schema.columns where table_name = 'mj_donate_acks' order by ordinal_position")).rows.map((r) => `${r.c}:${r.d ?? ""}`);
  let rerun = "ok"; try { await db.exec(read("20261102_mahjong_donate_deduct.sql")); } catch (e) { rerun = (e as Error).message; }
  eq([JSON.stringify(after) === JSON.stringify(before), before.slice(1), cols, rerun, await snapshot(db) === before[0]],
    [true, [1, 1], ["user_id:", "acked_at:", "carried:0", "seen_count:0", "reset_source:", "reset_cleared:"], "ok", true],
    "M1 套用前 A 有歸零點（次數 1）、B 沒有（次數 1）：套用後歸零點、自摸紀錄、次數都不變；新欄位預設 0／null；重跑一次也不出錯、不改資料");

  // ---- M2 權限 ----
  const fns = ["mj_donation_record('x','x','x',null,1,now(),'')", `mj_zimo_clear('x','${A}')`, `mj_donate_seen('${A}', 1)`, `mj_donate_status('${A}')`, "mj_zimo_counts()",
    `mj_donate_settle('${A}', 1, 'clear', now())`, `mj_donate_count('${A}')`];
  const denied: boolean[] = [];
  for (const role of ["anon", "authenticated"]) {
    for (const f of [...fns.map((f) => `select * from public.${f}`), "select * from mj_donate_acks", `update mj_donate_acks set seen_count = 9`]) {
      try { await db.exec(`set role ${role}; ${f}; reset role;`); denied.push(false); } catch { await db.exec("reset role"); denied.push(true); }
    }
  }
  let svc = "ok"; try { await db.exec(`set role service_role; select * from public.mj_donate_status('${A}'); reset role;`); } catch (e) { await db.exec("reset role"); svc = (e as Error).message; }
  eq([denied.every(Boolean), denied.length, svc], [true, 18, "ok"], "M2 anon、authenticated 執行 7 支函式、讀寫 mj_donate_acks 全部被拒；service_role 可以執行");

  // ---- M4 回滾 ----
  await db.exec(`select public.mj_zimo_clear('boss', '${A}')`); // 寫一筆 zimo_clear 紀錄
  await db.exec(`insert into mj_zimo_wins values ('00000000-0000-4000-8000-000000000009', 1, '${B}', now() - interval '1 minute')`);
  await db.exec(read("20261102_mahjong_donate_deduct_rollback.sql"));
  const gone = (await db.query<{ n: number }>("select count(*)::int n from pg_proc where proname in ('mj_donation_record','mj_zimo_clear','mj_donate_seen','mj_donate_status','mj_zimo_counts','mj_donate_settle')")).rows[0].n;
  const colsAfter = (await db.query<{ c: string }>("select column_name c from information_schema.columns where table_name = 'mj_donate_acks' order by ordinal_position")).rows.map((r) => r.c);
  await db.exec(`select public.mj_donation_add('boss', '${B}', 'B', null, 10, now(), '')`);
  const bAfter = await one(db, `select public.mj_donate_count('${B}') v`);
  const zc = await one(db, "select pg_get_constraintdef(oid) v from pg_constraint where conname = 'mj_fx_audit_action_check'");
  let rerunRb = "ok"; try { await db.exec(read("20261102_mahjong_donate_deduct_rollback.sql")); } catch (e) { rerunRb = (e as Error).message; }
  eq([gone, colsAfter, bAfter, String(zc).includes("zimo_clear"), rerunRb], [0, ["user_id", "acked_at"], 0, true, "ok"],
    "M4 回滾：6 支新函式、4 個新欄位拿掉；記一筆改回直接歸零（B 2 次斗 NT$10 → 0）；已有 zimo_clear 紀錄所以 action 檢查維持放寬；回滾可重跑");
}

// ---- M4b 沒有 zimo_clear 紀錄時，action 檢查改回原本 ----
{
  const db = await base();
  await db.exec(read("20261102_mahjong_donate_deduct.sql"));
  await db.exec(read("20261102_mahjong_donate_deduct_rollback.sql"));
  const zc = await one(db, "select pg_get_constraintdef(oid) v from pg_constraint where conname = 'mj_fx_audit_action_check'");
  eq(String(zc).includes("zimo_clear"), false, "M4b 沒有 zimo_clear 紀錄：回滾後操作紀錄的 action 檢查改回原本 5 種");
}

// ---- M3 前提沒套用 ----
{
  const db = await base(false);
  const before = JSON.stringify((await db.query("select column_name from information_schema.columns where table_name = 'mj_donate_acks'")).rows);
  let err = ""; try { await db.exec(read("20261102_mahjong_donate_deduct.sql")); } catch (e) { err = (e as Error).message; }
  try { await db.exec("rollback"); } catch { /* 已經結束 */ }
  const after = JSON.stringify((await db.query("select column_name from information_schema.columns where table_name = 'mj_donate_acks'")).rows);
  eq([err.includes("拒絕套用"), before === after], [true, true], "M3 沒有 20261031（mj_fx_audit）時整份拒絕，mj_donate_acks 沒有被改");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

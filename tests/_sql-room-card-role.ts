// 房卡扣卡在「正式站的權限」下要能動（老柯 2026-11-20，正式站房卡沒扣的根因）：
// 伺服器用 service_role 呼叫 room_card_charge；正式站的 service_role 讀不到 auth.users（has_table_privilege = false），
// 而扣卡要讀 auth.users 排除遊客 → 正式站每一次扣卡都「permission denied for table users」，只寫 log，一張都沒扣。
// 之前的測試是用超級使用者呼叫函式，所以沒抓到。這支照正式站的權限跑：
//   P1 前提：service_role 讀不到 auth.users（和正式站一樣）
//   P2 用 service_role 扣卡：一般帳號各扣 1 張、遊客不扣、同一把重送不重複扣
//   P3 修正（SECURITY DEFINER）沒有放寬權限：anon、authenticated 還是不能呼叫扣卡；service_role 還是不能直接讀 auth.users
//   P4 充值、回收、暫停、名單、全部流水帳在 service_role 下照常（之前就正常，確認沒被影響）
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_SETUP } from "./support/pg-mj";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const d = new PGlite();
await d.exec(SUPABASE_SETUP);
await d.exec(`alter table auth.users add column raw_user_meta_data jsonb not null default '{}';
  create table public.mj_rooms (id uuid primary key, code text, status text); create table public.mj_players (room_id uuid, user_id uuid);
  create table public.th_rooms (id uuid primary key, code text, status text); create table public.th_players (room_id uuid, user_id uuid);`);
for (const f of ["20261120_room_cards.sql", "20261120_room_card_charge_definer.sql"]) if (existsSync(path.join(MIG, f))) await d.exec(readFileSync(path.join(MIG, f), "utf8"));
const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000b2", G = "00000000-0000-4000-8000-0000000000f6";
await d.query(`insert into auth.users (id, raw_app_meta_data) values ($1, '{"provider":"custom:line"}'), ($2, '{"provider":"custom:line"}'), ($3, '{"guest":true}')`, [A, B, G]);
async function as<T>(role: string, sql: string): Promise<T | string> {
  try { return await d.transaction(async (tx) => { await tx.exec(`set local role ${role}`); return (await tx.query<{ r: T }>(sql)).rows[0]?.r as T; }); }
  catch (e) { return `擋下：${(e as Error).message}`; }
}
const charge = (hand: number) => as<number>("service_role", `select public.room_card_charge('thirteen', 'room-x', '3406', ${hand}, array['${A}', '${B}', '${G}']::uuid[]) as r`);

// P1
eq(String(await as("service_role", `select count(*) as r from auth.users`)).startsWith("擋下"), true, "P1 前提：service_role 讀不到 auth.users（正式站 has_table_privilege('service_role','auth.users','select') = false）");
// P2
{
  const first = await charge(1), again = await charge(1), third = await charge(3);
  const bal = (await d.query<{ user_id: string; balance: number }>(`select user_id, balance from room_card_accounts order by user_id`)).rows.map((r) => [r.user_id.slice(-2), r.balance]);
  eq([first, again, third, bal], [2, 0, 2, [["a1", -2], ["b2", -2]]], "P2 用 service_role 扣卡：第 1 局兩個一般帳號各扣 1、遊客不扣；重送第 1 局 0 人；第 3 局再各扣 1");
}
// P3
{
  const anon = await as("anon", `select public.room_card_charge('thirteen', 'room-y', '1', 1, array['${A}']::uuid[]) as r`);
  const auth = await as("authenticated", `select public.room_card_charge('thirteen', 'room-y', '1', 1, array['${A}']::uuid[]) as r`);
  const users = await as("service_role", `select count(*) as r from auth.users`);
  const def = (await d.query<{ s: boolean; c: string[] }>(`select prosecdef s, proconfig c from pg_proc where proname = 'room_card_charge'`)).rows[0];
  eq([String(anon).startsWith("擋下"), String(auth).startsWith("擋下"), String(users).startsWith("擋下"), def.s, (def.c ?? []).some((x) => x.startsWith("search_path="))],
    [true, true, true, true, true], "P3 anon、authenticated 還是不能扣卡；service_role 還是不能直接讀 auth.users；扣卡函式是 SECURITY DEFINER 並固定 search_path");
}
// P4
{
  const t = await as<{ ok: boolean }>("service_role", `select public.room_card_topup('boss', '${A}', 5, '00000000-0000-4000-9000-000000000001') as r`);
  const s = await as<{ ok: boolean }>("service_role", `select public.room_card_set_suspended('boss', '${B}', true, '00000000-0000-4000-9000-000000000002') as r`);
  const p = await as<number>("service_role", `select count(*)::int as r from public.room_card_players()`);
  eq([(t as { ok: boolean }).ok, (s as { ok: boolean }).ok, p], [true, true, 2], "P4 充值、暫停、玩家名單在 service_role 下照常");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);

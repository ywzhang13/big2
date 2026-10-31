// 測試用：lib/mahjong/donate/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261021_mahjong_donate.sql，呼叫真的函式，時間用 clock.now 控制。
// 次數、看過次數要用到 20261102（斗內抵扣）改過的函式：查詢前先等 stub-zimofx-store 把後面的 migration 都套上（同一個資料庫）。
// 模擬 Supabase 的 auth.users（遊客的 app_metadata.guest = true）；測試用 addUser 先建帳號。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const clock = { now: Date.parse("2026-10-21T00:00:00Z") };
const at = () => new Date(clock.now).toISOString();

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = new PGlite();
    await d.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');`);
    const sql = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261021_mahjong_donate.sql");
    await d.exec(readFileSync(sql, "utf8"));
    return d;
  })();
  return dbp;
}

/** 測試用：建一個帳號（guest=true 是遊客） */
export async function addUser(id: string, guest = false): Promise<void> {
  await (await db()).query("insert into auth.users (id, raw_app_meta_data) values ($1, $2) on conflict do nothing", [id, guest ? { guest: true } : { provider: "line" }]);
}

export async function recordZimo(roomId: string, handNo: number, userIds: string[]): Promise<number> {
  const r = await (await db()).query<{ n: number }>("select public.mj_zimo_record($1, $2, $3::uuid[], $4) as n", [roomId, handNo, userIds, at()]);
  return Number(r.rows[0].n);
}
async function full(): Promise<PGlite> { return (await import("./stub-zimofx-store")).db(); }
export async function countZimo(userId: string): Promise<number> {
  const r = await (await full()).query<{ n: number }>("select public.mj_donate_count($1) as n", [userId]);
  return Number(r.rows[0].n);
}
export async function donateStatus(userId: string): Promise<{ count: number; seen: number }> {
  const r = await (await full()).query<{ count: number; seen: number }>("select * from public.mj_donate_status($1)", [userId]);
  return { count: Number(r.rows[0].count), seen: Number(r.rows[0].seen) };
}
export async function markSeen(userId: string, count: number): Promise<{ count: number; seen: number }> {
  const r = await (await full()).query<{ count: number; seen: number }>("select * from public.mj_donate_seen($1, $2)", [userId, count]);
  return { count: Number(r.rows[0].count), seen: Number(r.rows[0].seen) };
}

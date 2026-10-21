// 測試用：lib/mahjong/userPrefs/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261022_mahjong_prefs.sql、20261023_mahjong_chat.sql（見 pg-mj.ts），
// 讀寫走同一張表（含外鍵、v2／v3 格式限制、大小限制）。
// 模擬 Supabase 的 auth.users；測試用 addUser 先建帳號。
import type { AccountPrefs } from "../../lib/mahjong/userPrefs/rules";
import { db } from "./pg-mj";
export { db };

export async function addUser(id: string, guest = false): Promise<void> {
  await (await db()).query("insert into auth.users (id, raw_app_meta_data) values ($1, $2) on conflict do nothing", [id, guest ? { guest: true } : {}]);
}
export const fail = { next: false }; // 模擬資料庫出錯

export async function loadAccountPrefs(userId: string): Promise<unknown | null> {
  if (fail.next) { fail.next = false; throw new Error("模擬資料庫錯誤"); }
  const r = await (await db()).query<{ prefs: unknown }>("select prefs from mj_user_prefs where user_id = $1", [userId]);
  return r.rows[0]?.prefs ?? null;
}
export async function saveAccountPrefs(userId: string, prefs: AccountPrefs): Promise<void> {
  if (fail.next) { fail.next = false; throw new Error("模擬資料庫錯誤"); }
  await (await db()).query(
    "insert into mj_user_prefs (user_id, prefs, updated_at) values ($1, $2, now()) on conflict (user_id) do update set prefs = excluded.prefs, updated_at = excluded.updated_at",
    [userId, prefs]
  );
}

// 測試用（老柯 2026-11-16）：十三支流程測試的資料庫——記憶體 PostgreSQL（PGlite）跑正式站現況＋真的 20261116 migration，
// 再把 supabase-js 的請求接進來（thirteen-postgrest.ts）。十三支的路由、db 層都是真程式碼，只有登入、廣播用 tests/support 的替身。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPostgrest } from "./thirteen-postgrest";
import { SUPABASE_SETUP } from "./pg-mj";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase");

export async function setupThirteenDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SETUP); // Supabase 的角色、auth.users、storage（和聊天、偏好設定的測試同一份）
  await db.exec(`alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql",
    "migrations/20261019_mahjong_rls_enforce.sql",
    // 聊天（十三支和麻將共用同一套聊天紀錄）：冷卻 → 聊天紀錄 → 十三支房間 → 讓聊天函式認得十三支房間
    "migrations/20261022_mahjong_prefs.sql", "migrations/20261023_mahjong_chat.sql", "migrations/20261024_mahjong_prefs_v4.sql",
    "migrations/20261113_mahjong_chat_history.sql", "migrations/20261116_thirteen_rooms.sql", "migrations/20261117_thirteen_chat.sql",
    "migrations/20261118_thirteen_records.sql", "migrations/20261118_thirteen_lobby.sql",
    "migrations/20261119_thirteen_base_score.sql"]) {
    await db.exec(readFileSync(path.join(SUPA, f), "utf8"));
  }
  const base = "http://thirteen-flow.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  installPostgrest(db, base);
  return db;
}

/**
 * 測試用：把房間（還在等人）的局數直接改成 n（2026-11-18 起開房只能選 8／16／32 局；
 * 測試要快速打完時，照「舊房照原設定打完」的方式，用資料庫直接改成較少的局數）
 */
export async function setTotalHands(db: PGlite, roomId: string, n: number): Promise<void> {
  await db.query(`update th_rooms set game_state = jsonb_set(game_state, '{settings,totalHands}', to_jsonb($2::int)) where id = $1`, [roomId, n]);
}

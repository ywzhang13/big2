// 測試用（老柯 2026-11-16）：十三支流程測試的資料庫——記憶體 PostgreSQL（PGlite）跑正式站現況＋真的 20261116 migration，
// 再把 supabase-js 的請求接進來（thirteen-postgrest.ts）。十三支的路由、db 層都是真程式碼，只有登入、廣播用 tests/support 的替身。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPostgrest } from "./thirteen-postgrest";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase");

export async function setupThirteenDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql",
    "migrations/20261019_mahjong_rls_enforce.sql", "migrations/20261116_thirteen_rooms.sql"]) {
    await db.exec(readFileSync(path.join(SUPA, f), "utf8"));
  }
  const base = "http://thirteen-flow.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  installPostgrest(db, base);
  return db;
}

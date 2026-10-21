// 測試用：模擬 Supabase 的記憶體 PostgreSQL（PGlite），依序跑真的 migration：
//   20261022_mahjong_prefs.sql（偏好設定）→ 20261023_mahjong_chat.sql（聊天冷卻、語音 bucket、偏好設定 v3 格式）。
// 模擬的部分：anon／authenticated／service_role 角色、auth.users、storage.buckets／storage.objects（開 RLS、沒有 policy）。
// stub-prefs-store、stub-chat-store 共用同一個資料庫。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
export const SUPABASE_SETUP = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (bucket_id text, name text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
`;

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = new PGlite();
    await d.exec(SUPABASE_SETUP);
    for (const f of ["20261022_mahjong_prefs.sql", "20261023_mahjong_chat.sql"]) await d.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    return d;
  })();
  return dbp;
}

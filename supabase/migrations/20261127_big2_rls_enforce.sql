-- 大老二資料表鎖權限（老柯 2026-11-27，照麻將 20261019_mahjong_rls_enforce.sql 的做法）：公開金鑰（anon、authenticated）讀不到、也寫不了大老二牌局
--
-- 為什麼要這份：schema.sql 給 big2_rooms／big2_players 建了「Allow all」policy，大老二伺服器也一直用公開金鑰連資料庫。
-- 公開金鑰本來就在前端程式裡，所以任何人都能直接查 big2_players.hand 讀到四家手牌，甚至改牌局、刪房。
-- 搭配的程式：大老二所有路由、lib/big2/*Store.ts 改用 service role（lib/supabase-admin.ts）——⚠️ 程式一定要先上線，再套這份。
--
-- 做的事（整份在一個 transaction 裡，失敗就全部不生效）：
--   ⓪ 先把兩張表「套用前」的 policy（含 permissive／restrictive）、資料表與欄位權限、RLS 與 FORCE RLS 狀態
--      完整備份到 big2_rls_backup schema。備份只在第一次套用時建立；重跑這份不會蓋掉原始備份。
--      回滾（20261127_big2_rls_enforce_rollback.sql）照這份備份精確還原。
--   ① 兩張表上的 policy 全部拿掉（不管名字、permissive 或 restrictive）
--   ② RLS 確定開啟（FORCE RLS 維持原狀：service_role 有 BYPASSRLS，不受影響）
--   ③ 收回 anon、authenticated、PUBLIC 對兩張表的資料表與欄位權限（PUBLIC 的權限 anon 也拿得到）
--   ④ service_role 保留全部權限
--   ⑤ 自我檢查：公開金鑰還留著任何權限或 policy 就丟錯，整份不生效
--
-- 影響範圍：只有 big2_rooms、big2_players，另外新增 big2_rls_backup schema（公開金鑰讀不到）。
--   big2_seat_keys 在 20261120 已經鎖好，不動。麻將、十三支、對局紀錄的表不動。
--   前端只用 Realtime 廣播頻道（big2-房號），不讀這兩張表，所以進行中的牌局不會斷線。
-- 確認穩定、不會再回滾之後，可以手動 drop schema big2_rls_backup cascade（見 _verify.sql 最後）。
begin;

-- ⓪ 備份（只在第一次建立）
create schema if not exists big2_rls_backup;
revoke all on schema big2_rls_backup from public, anon, authenticated;

do $$
begin
  if to_regclass('big2_rls_backup.meta') is not null then
    return; -- 已經有原始備份：重跑時不覆蓋
  end if;

  create table big2_rls_backup.meta (taken_at timestamptz not null default now());
  insert into big2_rls_backup.meta default values;

  -- RLS 與 FORCE RLS
  create table big2_rls_backup.rls as
    select c.relname::text as tablename, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('big2_rooms', 'big2_players');

  -- policy 完整定義
  create table big2_rls_backup.policies as
    select tablename::text, policyname::text, permissive::text, roles::text[] as roles, cmd::text, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in ('big2_rooms', 'big2_players');

  -- 資料表權限（attname 為 null）與欄位權限（attname 有值）；grantee 0 = PUBLIC；不含擁有者自己
  create table big2_rls_backup.grants as
    select c.relname::text as tablename, null::text as attname,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
           a.privilege_type::text, a.is_grantable, a.grantor::regrole::text as grantor
    from pg_class c, lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('big2_rooms', 'big2_players')
      and a.grantee <> c.relowner
    union all
    select c.relname::text, att.attname::text,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
           a.privilege_type::text, a.is_grantable, a.grantor::regrole::text
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null,
    lateral aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('big2_rooms', 'big2_players')
      and a.grantee <> c.relowner;

  revoke all on all tables in schema big2_rls_backup from public, anon, authenticated;
end $$;

-- ① policy 全部拿掉
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('big2_rooms', 'big2_players')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ② RLS 開啟
alter table public.big2_rooms enable row level security;
alter table public.big2_players enable row level security;

-- ③ 收回公開金鑰的權限（REVOKE 資料表權限時，同一個角色的欄位權限也會一起收回）
revoke all on table public.big2_rooms, public.big2_players from public, anon, authenticated;

-- ④ service_role 保留全部權限
grant all on table public.big2_rooms, public.big2_players to service_role;

-- ⑤ 自我檢查：公開金鑰（anon、authenticated、PUBLIC）還留著任何資料表或欄位權限、或還有 policy，就丟錯讓整份不生效
--    （例如權限是別的 grantor 給的，REVOKE 收不掉）
do $$
declare
  n int;
begin
  -- 欄位權限
  select count(*) into n
  from pg_class c
  join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null,
  lateral aclexplode(att.attacl) a
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('big2_rooms', 'big2_players')
    and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));
  -- 資料表權限
  select n + count(*) into n
  from pg_class c, lateral aclexplode(c.relacl) a
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('big2_rooms', 'big2_players')
    and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));
  if n > 0 then
    raise exception '鎖表沒有完成：公開金鑰還有 % 筆權限（可能是別的 grantor 給的），整份不生效', n;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename in ('big2_rooms', 'big2_players')) then
    raise exception '鎖表沒有完成：還有 policy，整份不生效';
  end if;
end $$;

commit;

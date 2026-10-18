-- 麻將資料表鎖權限（2026-10-19）：公開金鑰（anon、authenticated）讀不到、也寫不了麻將牌局和對局紀錄
--
-- 為什麼要這份：2026-10-19 用網站公開的 anon key 實測，正式庫的 mj_rooms／mj_players 仍然讀得到全部資料
-- （game_state 裡的四家手牌、牌牆順序，mj_players 的 user_id）。20261017_mahjong_lockdown.sql 寫好了但沒套用到正式庫，
-- 「Allow all」policy 還在，所以連改牌局、刪房都做得到。這份取代 20261017_mahjong_lockdown.sql。
--
-- 做的事（整份在一個 transaction 裡，失敗就全部不生效）：
--   ⓪ 先把四張表「套用前」的 policy（含 permissive／restrictive）、資料表與欄位權限、RLS 與 FORCE RLS 狀態
--      完整備份到 mj_rls_backup schema。備份只在第一次套用時建立；重跑這份不會蓋掉原始備份。
--      回滾（20261019_mahjong_rls_enforce_rollback.sql）照這份備份精確還原。
--   ① 四張表上的 policy 全部拿掉（不管名字、permissive 或 restrictive）
--   ② RLS 確定開啟（FORCE RLS 維持原狀：service_role 有 BYPASSRLS，不受影響）
--   ③ 收回 anon、authenticated、PUBLIC 對四張表的資料表與欄位權限（PUBLIC 的權限 anon 也拿得到）
--   ④ service_role 保留全部權限（伺服器的麻將路由、對局紀錄一律用 service role，會略過 RLS）
--
-- 影響範圍：只有 mj_rooms、mj_players、match_records、match_record_players，另外新增 mj_rls_backup schema（公開金鑰讀不到）。
--   大老二的 big2_rooms／big2_players 不動（大老二的路由用公開金鑰讀寫，鎖了大老二就壞）。
--   同一個資料庫裡的其他服務（commercialbot 等）不動。
--   前端只用 Realtime 廣播頻道（mj-房號、座位頻道），不讀這些表，所以進行中的牌局不會斷線。
-- 確認穩定、不會再回滾之後，可以手動 drop schema mj_rls_backup cascade（見 _verify.sql 最後）。
begin;

-- ⓪ 備份（只在第一次建立）
create schema if not exists mj_rls_backup;
revoke all on schema mj_rls_backup from public, anon, authenticated;

do $$
begin
  if to_regclass('mj_rls_backup.meta') is not null then
    return; -- 已經有原始備份：重跑時不覆蓋
  end if;

  create table mj_rls_backup.meta (taken_at timestamptz not null default now());
  insert into mj_rls_backup.meta default values;

  -- RLS 與 FORCE RLS
  create table mj_rls_backup.rls as
    select c.relname::text as tablename, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players');

  -- policy 完整定義
  create table mj_rls_backup.policies as
    select tablename::text, policyname::text, permissive::text, roles::text[] as roles, cmd::text, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players');

  -- 資料表權限（attname 為 null）與欄位權限（attname 有值）；grantee 0 = PUBLIC；不含擁有者自己
  create table mj_rls_backup.grants as
    select c.relname::text as tablename, null::text as attname,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
           a.privilege_type::text, a.is_grantable, a.grantor::regrole::text as grantor
    from pg_class c, lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
      and a.grantee <> c.relowner
    union all
    select c.relname::text, att.attname::text,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
           a.privilege_type::text, a.is_grantable, a.grantor::regrole::text
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null,
    lateral aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
      and a.grantee <> c.relowner;

  revoke all on all tables in schema mj_rls_backup from public, anon, authenticated;
end $$;

-- ① policy 全部拿掉
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ② RLS 開啟
alter table public.mj_rooms enable row level security;
alter table public.mj_players enable row level security;
alter table public.match_records enable row level security;
alter table public.match_record_players enable row level security;

-- ③ 收回公開金鑰的權限（REVOKE 資料表權限時，同一個角色的欄位權限也會一起收回）
revoke all on table public.mj_rooms, public.mj_players, public.match_records, public.match_record_players from public, anon, authenticated;

-- ④ service_role 保留全部權限
grant all on table public.mj_rooms, public.mj_players, public.match_records, public.match_record_players to service_role;

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
    and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
    and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));
  -- 資料表權限
  select n + count(*) into n
  from pg_class c, lateral aclexplode(c.relacl) a
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
    and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));
  if n > 0 then
    raise exception '鎖表沒有完成：公開金鑰還有 % 筆權限（可能是別的 grantor 給的），整份不生效', n;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')) then
    raise exception '鎖表沒有完成：還有 policy，整份不生效';
  end if;
end $$;

commit;

-- 20261019_mahjong_rls_enforce 的檢查查詢（1～6 全部唯讀，在 Supabase SQL Editor 跑）
-- 套用前跑一次、結果存進上線紀錄；套用後、回滾後再跑一次對照。

-- 1. 四張表上的 policy（套用前應該看得到 "Allow all on mj_rooms"／"Allow all on mj_players"；套用後應該 0 筆）
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
order by tablename, policyname;

-- 2. RLS 與 FORCE RLS（套用後 relrowsecurity 四張都要是 true；FORCE RLS 維持套用前的值）
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
order by relname;

-- 3. 資料表與欄位權限（含 grantor、grant option）
--    套用後：grantee 不能出現 anon、authenticated、PUBLIC；service_role 要有 SELECT／INSERT／UPDATE／DELETE。
--    ⚠️ 套用前如果看到 grantor 不是 postgres 的 anon／authenticated／PUBLIC 權限，enforce 會因為收不掉而整份不生效（安全的結果），要先處理那筆權限。
select c.relname, null as attname,
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
       a.grantor::regrole::text as grantor, a.privilege_type, a.is_grantable
from pg_class c, lateral aclexplode(c.relacl) a
where c.relnamespace = 'public'::regnamespace and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
union all
select c.relname, att.attname,
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
       a.grantor::regrole::text, a.privilege_type, a.is_grantable
from pg_class c
join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null,
lateral aclexplode(att.attacl) a
where c.relnamespace = 'public'::regnamespace and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
order by 1, 2 nulls first, 3, 5;

-- 3b. 回滾的前提：執行者要能切換成每個 grantor（回滾會用原本的 grantor 身分收回、補回權限）。
--     套用前跑：這裡列出的每一列 can_set_role 都要是 true，否則之後回滾會丟錯、什麼都不改（安全，但回滾不了）。
select distinct g.grantor, pg_has_role(current_user, g.grantor::regrole, 'MEMBER') as can_set_role
from (
  select a.grantor::regrole::text as grantor
  from pg_class c, lateral aclexplode(c.relacl) a
  where c.relnamespace = 'public'::regnamespace and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
    and a.grantee <> c.relowner
  union
  select a.grantor::regrole::text
  from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null,
  lateral aclexplode(att.attacl) a
  where c.relnamespace = 'public'::regnamespace and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players')
    and a.grantee <> c.relowner
) g
order by 1;

-- 4. 大老二沒被動到（套用前後應該一樣）
select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('big2_rooms', 'big2_players') order by 1, 2;

-- 5. 麻將 Realtime 不靠 postgres_changes：列出在 realtime publication 裡的麻將表（有也不影響，RLS 會擋掉 anon 的變更事件）
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players');

-- 6. 套用後才有：enforce 存下的「套用前」備份（回滾就照這份還原）。內容要和套用前跑的 1～3 一致
select * from mj_rls_backup.meta;
select * from mj_rls_backup.rls order by tablename;
select * from mj_rls_backup.policies order by tablename, policyname;
select * from mj_rls_backup.grants order by tablename, attname nulls first, grantee, privilege_type;

-- 7. 確認穩定、不會再回滾之後才跑（會刪掉回滾需要的備份）：
-- drop schema mj_rls_backup cascade;

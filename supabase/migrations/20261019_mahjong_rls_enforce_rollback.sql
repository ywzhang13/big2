-- 回滾 20261019_mahjong_rls_enforce.sql：照 mj_rls_backup 裡「套用前」的備份，精確還原四張表的
--   ① policy（名字、permissive／restrictive、角色、指令、USING、WITH CHECK）
--   ② 資料表與欄位權限：含 PUBLIC、WITH GRANT OPTION，以及「由誰授予」（grantor）。
--      收回和補回都切換成當初的 grantor 身分執行（SET ROLE），所以 grantor 和 CASCADE 相依關係跟套用前一樣；
--      套用後才多出來的權限一律收回。
--   ③ RLS 與 FORCE RLS 狀態
-- 整份在一個 transaction 裡；任何一步做不到（沒有備份、切換不到某個 grantor、grantor 已經沒有 grant option）就丟錯，
-- 什麼都不改——絕不會悄悄用別的 grantor 補權限。可以重跑（每次都還原成同一份備份）。
-- 執行者必須能 SET ROLE 成備份裡的每個 grantor（superuser，或是那些角色的成員）。
-- 備份保留不刪：之後要再鎖，直接重跑 enforce（不會蓋掉原始備份）。確認不再需要才手動 drop schema mj_rls_backup cascade。
-- ⚠️ 回滾後公開金鑰又讀得到四家手牌和牌牆，只在新版造成麻將壞掉、需要緊急恢復時才跑。
begin;

do $$
declare
  t text;
  r record;
  roles_sql text;
  stmt text;
  me text := current_user;
  owner_role oid;
  pending int;
  progressed boolean;
  can boolean;
begin
  if to_regclass('mj_rls_backup.meta') is null then
    raise exception '找不到 mj_rls_backup 備份：enforce 沒有跑過，或備份已經刪掉，不能回滾';
  end if;

  -- 先確認切換得到所有會用到的 grantor（目前 ACL 裡的、備份裡的），做不到就在動任何東西之前停下
  for r in
    select distinct g from (
      select a.grantor::regrole::text as g
      from pg_class c, lateral aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players') and a.grantee <> c.relowner
      union
      select a.grantor::regrole::text
      from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null,
      lateral aclexplode(att.attacl) a
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('mj_rooms', 'mj_players', 'match_records', 'match_record_players') and a.grantee <> c.relowner
      union
      select grantor from mj_rls_backup.grants
    ) x
  loop
    if to_regrole(r.g) is null then
      raise exception '備份裡的 grantor % 已經不存在，無法精確還原', r.g;
    end if;
    if not pg_has_role(me, r.g::regrole, 'MEMBER') then
      raise exception '執行者 % 不能切換成 grantor %（不是 superuser 也不是該角色的成員），無法精確還原', me, r.g;
    end if;
  end loop;

  foreach t in array array['mj_rooms', 'mj_players', 'match_records', 'match_record_players'] loop
    select relowner into owner_role from pg_class where oid = format('public.%I', t)::regclass;

    -- ① 收回目前所有非擁有者的資料表與欄位權限：逐筆用當初的 grantor 身分收（REVOKE 只收得掉自己授予的；
    --    grantor 可能只有欄位權限，所以欄位權限要用「權限 (欄位)」的寫法收）
    for r in
      select a.grantor::regrole::text as grantor, null::text as attname,
             case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee, a.privilege_type
      from pg_class c, lateral aclexplode(c.relacl) a
      where c.oid = format('public.%I', t)::regclass and a.grantee <> c.relowner
      union all
      select a.grantor::regrole::text, att.attname::text,
             case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
      from pg_class c
      join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null,
      lateral aclexplode(att.attacl) a
      where c.oid = format('public.%I', t)::regclass and a.grantee <> c.relowner
      order by 2 nulls first, 1, 3, 4
    loop
      -- 前面某一筆的 CASCADE 可能已經連帶收掉這筆（例如先收了 grantor 自己的 grant option）：還在才收
      continue when not exists (
        select 1 from pg_class c, lateral aclexplode(c.relacl) a
        where r.attname is null and c.oid = format('public.%I', t)::regclass and a.grantor = r.grantor::regrole
          and a.privilege_type = r.privilege_type
          and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) = r.grantee
        union all
        select 1 from pg_attribute att, lateral aclexplode(att.attacl) a
        where r.attname is not null and att.attrelid = format('public.%I', t)::regclass and att.attname = r.attname
          and att.attacl is not null and a.grantor = r.grantor::regrole and a.privilege_type = r.privilege_type
          and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) = r.grantee);
      execute format('set role %s', r.grantor);
      execute format('revoke %s%s on table public.%I from %s cascade', r.privilege_type,
        case when r.attname is null then '' else format(' (%I)', r.attname) end, t, r.grantee);
      execute format('set role %I', me);
    end loop;
    if exists (select 1 from pg_class c, lateral aclexplode(c.relacl) a
               where c.oid = format('public.%I', t)::regclass and a.grantee <> c.relowner)
       or exists (select 1 from pg_attribute att, lateral aclexplode(att.attacl) a
                  where att.attrelid = format('public.%I', t)::regclass and att.attnum > 0 and att.attacl is not null
                    and a.grantee <> owner_role) then
      raise exception '回滾沒有完成：% 還有收不掉的權限', t;
    end if;

    -- ② 照備份補回權限：用備份裡的 grantor 身分授予。grant option 有先後關係（A 給 B、B 再給 C），
    --    所以一輪一輪補：grantor 是擁有者、或已經拿到該權限的 grant option 時才補；一輪都補不了就丟錯
    create temp table if not exists _mj_rls_todo (tablename text, attname text, grantee text, privilege_type text, is_grantable boolean, grantor text, done boolean) on commit drop;
    delete from _mj_rls_todo;
    insert into _mj_rls_todo select g.tablename, g.attname, g.grantee, g.privilege_type, g.is_grantable, g.grantor, false
      from mj_rls_backup.grants g where g.tablename = t;
    loop
      select count(*) into pending from _mj_rls_todo where not done;
      exit when pending = 0;
      progressed := false;
      for r in select * from _mj_rls_todo where not done order by attname nulls first, grantor, grantee, privilege_type loop
        can := r.grantor::regrole = owner_role
          or (r.attname is null and has_table_privilege(r.grantor::regrole, format('public.%I', t)::regclass, r.privilege_type || ' WITH GRANT OPTION'))
          or (r.attname is not null and has_column_privilege(r.grantor::regrole, format('public.%I', t)::regclass, r.attname, r.privilege_type || ' WITH GRANT OPTION'));
        continue when not can;
        stmt := format('grant %s%s on table public.%I to %s%s',
          r.privilege_type,
          case when r.attname is null then '' else format(' (%I)', r.attname) end,
          t, r.grantee,
          case when r.is_grantable then ' with grant option' else '' end);
        execute format('set role %s', r.grantor);
        execute stmt;
        execute format('set role %I', me);
        update _mj_rls_todo set done = true
          where attname is not distinct from r.attname and grantee = r.grantee and privilege_type = r.privilege_type and grantor = r.grantor;
        progressed := true;
      end loop;
      if not progressed then
        raise exception '回滾沒有完成：% 有 % 筆權限的 grantor 已經沒有 grant option，無法用原本的 grantor 補回', t, pending;
      end if;
    end loop;

    -- ③ policy：拿掉目前全部，照備份重建
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    for r in select * from mj_rls_backup.policies p where p.tablename = t order by p.policyname loop
      select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') into roles_sql from unnest(r.roles) x;
      stmt := format('create policy %I on public.%I as %s for %s to %s', r.policyname, t, r.permissive, r.cmd, roles_sql);
      if r.qual is not null then stmt := stmt || format(' using (%s)', r.qual); end if;
      if r.with_check is not null then stmt := stmt || format(' with check (%s)', r.with_check); end if;
      execute stmt;
    end loop;

    -- ④ RLS 與 FORCE RLS
    for r in select * from mj_rls_backup.rls b where b.tablename = t loop
      execute format('alter table public.%I %s row level security', t, case when r.relrowsecurity then 'enable' else 'disable' end);
      execute format('alter table public.%I %s row level security', t, case when r.relforcerowsecurity then 'force' else 'no force' end);
    end loop;
  end loop;
end $$;

commit;

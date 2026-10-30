-- 麻將自摸特效庫＋斗內後台（2026-10-31，老闆定案）
--
-- 規則（時間、週界線由伺服器算好傳入，見 lib/mahjong/zimoFx/rules.ts）：
--   ・一週＝週一 00:00 到週日 23:59:59（Asia/Taipei）
--   ・斗內紀錄：只有老闆能新增（伺服器檢查）；只能作廢、不能刪除或改原值；作廢要記原因和時間
--   ・老闆記一筆斗內＝那位玩家的斗內卡自摸次數歸零（同一個交易，沿用 20261021 的 mj_donate_acks 歸零點）；作廢不還原次數。
--     玩家自己按「斗內給阿瑋」不再歸零（老闆 2026-10-31：前台只能看和按）
--   ・特效開通：老闆勾選玩家可用的特效、指定目前套用哪一種；有效到開通當週的週日 23:59:59，到期自動失效；可以提前收回
--   ・每一次後台操作和玩家自己換特效，都寫進操作紀錄（不能改、不能刪）
--
-- 新增：
--   ① mj_donations：斗內紀錄（玩家帳號、當時的 LINE 名稱與頭像、金額、斗內時間、備註；作廢欄位）
--   ② mj_fx_grants：特效開通，一次開通每一種特效各一列；收回只填 revoked_*，不覆寫、不刪
--   ③ mj_fx_prefs：每個帳號目前選用的特效（老闆開通時指定，玩家之後可以自己換）
--   ④ mj_fx_audit：操作紀錄
--   ⑤ 函式 mj_donation_add／mj_donation_void／mj_fx_grant／mj_fx_revoke／mj_fx_select（各自連同操作紀錄在同一個交易完成）、
--      mj_zimo_fx_for（胡牌時查幾個帳號目前選用的特效和到期時間）
--   ⑥ 觸發器：斗內紀錄只能「從有效改成作廢」一次；開通紀錄只能「從有效改成收回」一次；操作紀錄完全不能改；三張表都不能刪。
--      例外：postgres 在同一個交易裡 set local mj.allow_purge = 'on' 才能刪（只給正式站實測後清測試資料用；伺服器金鑰設不了）
--
-- 權限：表和函式只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   最後的自我檢查不成立就丟錯，整份不生效。只新增、不改現有資料表；回滾見 20261031_mahjong_zimo_fx_rollback.sql。
-- 前提：20261021_mahjong_donate.sql 已經套用（要有它建的 mj_donate_acks），否則整份拒絕。
-- 既有同名物件：都加上標記註解 'mj_zimo_fx:20261031'。同名物件不是這份建的就整份拒絕；重跑看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_zimo_fx:20261031';
  t text;
begin
  foreach t in array array['mj_donations', 'mj_fx_grants', 'mj_fx_prefs', 'mj_fx_audit'] loop
    if to_regclass('public.' || t) is not null and obj_description(to_regclass('public.' || t), 'pg_class') is distinct from v_marker then
      raise exception '拒絕套用：public.% 已經存在，而且不是這份 migration 建的', t;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('mj_donation_add', 'mj_donation_void', 'mj_fx_grant', 'mj_fx_revoke', 'mj_fx_select', 'mj_zimo_fx_for', 'mj_zimo_fx_guard')
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕套用：mj_donation_*／mj_fx_*／mj_zimo_fx_* 函式已經存在，而且不是這份 migration 建的';
  end if;
  if to_regclass('public.mj_donate_acks') is null or obj_description(to_regclass('public.mj_donate_acks'), 'pg_class') is distinct from 'mj_donate:20261021' then
    raise exception '拒絕套用：public.mj_donate_acks 不存在或不是 20261021_mahjong_donate.sql 建的；請先套用那份';
  end if;
end $$;

create table if not exists public.mj_donations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,              -- 斗內的玩家（登入帳號 id；只在伺服器和老闆後台用）
  player_name text not null,          -- 記帳當時的 LINE 名稱（排行榜顯示用）
  player_avatar text,                 -- 記帳當時的 LINE 頭像網址
  amount integer not null check (amount between 1 and 999999),
  donated_at timestamptz not null,    -- 實收時間（算哪一週）
  note text not null default '' check (length(note) <= 200),
  created_by text not null,
  created_at timestamptz not null,
  voided_at timestamptz,
  voided_by text,
  void_reason text check (void_reason is null or length(void_reason) between 1 and 200),
  check ((voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null))
);
create index if not exists mj_donations_week on public.mj_donations (donated_at) where voided_at is null;

create table if not exists public.mj_fx_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  fx text not null check (fx in ('meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura')),
  granted_by text not null,
  granted_at timestamptz not null,
  expires_at timestamptz not null,    -- 開通當週的下週一 00:00（不含）＝週日 23:59:59 是最後一刻
  revoked_at timestamptz,
  revoked_by text,
  check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists mj_fx_grants_active on public.mj_fx_grants (user_id, expires_at) where revoked_at is null;

create table if not exists public.mj_fx_prefs (
  user_id text primary key,
  fx text not null check (fx in ('meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura')),
  updated_at timestamptz not null
);

create table if not exists public.mj_fx_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  actor_id text not null,
  action text not null check (action in ('donation_add', 'donation_void', 'fx_grant', 'fx_revoke', 'fx_select')),
  target_user_id text not null,
  record_id uuid,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists mj_fx_audit_at on public.mj_fx_audit (at desc);

-- 觸發器：只准「有效 → 作廢／收回」一次，其他欄位不能動；操作紀錄完全不能改；三張表都不能刪（mj.allow_purge 例外，見檔頭）
create or replace function public.mj_zimo_fx_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('mj.allow_purge', true), '') = 'on' then return old; end if;
    raise exception '%：紀錄不能刪除', tg_table_name;
  end if;
  if tg_table_name = 'mj_fx_audit' then
    raise exception 'mj_fx_audit：操作紀錄不能修改';
  end if;
  if tg_table_name = 'mj_donations' then
    if old.voided_at is not null or new.voided_at is null
       or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
      raise exception 'mj_donations：只能把有效紀錄作廢一次，不能改其他欄位';
    end if;
  elsif tg_table_name = 'mj_fx_grants' then
    if old.revoked_at is not null or new.revoked_at is null
       or (to_jsonb(new) - array['revoked_at', 'revoked_by']) <> (to_jsonb(old) - array['revoked_at', 'revoked_by']) then
      raise exception 'mj_fx_grants：只能把有效開通收回一次，不能改其他欄位';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists mj_donations_guard on public.mj_donations;
create trigger mj_donations_guard before update or delete on public.mj_donations for each row execute function public.mj_zimo_fx_guard();
drop trigger if exists mj_fx_grants_guard on public.mj_fx_grants;
create trigger mj_fx_grants_guard before update or delete on public.mj_fx_grants for each row execute function public.mj_zimo_fx_guard();
drop trigger if exists mj_fx_audit_guard on public.mj_fx_audit;
create trigger mj_fx_audit_guard before update or delete on public.mj_fx_audit for each row execute function public.mj_zimo_fx_guard();

-- 記一筆斗內（連同操作紀錄），同一個交易裡把這位玩家的斗內卡自摸次數歸零（歸零點設成現在，只往後移）。回傳新紀錄 id
create or replace function public.mj_donation_add(
  p_actor text, p_user text, p_name text, p_avatar text, p_amount int, p_donated_at timestamptz, p_note text,
  p_now timestamptz default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_id uuid;
begin
  insert into mj_donations (user_id, player_name, player_avatar, amount, donated_at, note, created_by, created_at)
  values (p_user, p_name, p_avatar, p_amount, p_donated_at, coalesce(p_note, ''), p_actor, v_now)
  returning id into v_id;
  insert into mj_donate_acks (user_id, acked_at) values (p_user::uuid, v_now)
  on conflict (user_id) do update set acked_at = greatest(mj_donate_acks.acked_at, excluded.acked_at);
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_add', p_user, v_id,
          jsonb_build_object('amount', p_amount, 'donated_at', p_donated_at, 'note', coalesce(p_note, ''), 'zimo_reset', true));
  return v_id;
end $$;

-- 作廢（連同操作紀錄）。回傳 true＝這次作廢成功；已作廢或沒有這筆回 false，什麼都不寫
create or replace function public.mj_donation_void(p_actor text, p_id uuid, p_reason text, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_row mj_donations%rowtype;
begin
  update mj_donations set voided_at = v_now, voided_by = p_actor, void_reason = p_reason
  where id = p_id and voided_at is null
  returning * into v_row;
  if not found then return false; end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_void', v_row.user_id, p_id, jsonb_build_object('amount', v_row.amount, 'reason', p_reason));
  return true;
end $$;

-- 開通：每一種特效各寫一列（到期時間由伺服器算好），並把「目前套用」設成 p_active（要在 p_fx 裡）。回傳開通幾種
create or replace function public.mj_fx_grant(p_actor text, p_user text, p_fx text[], p_active text, p_expires timestamptz, p_now timestamptz default null) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n int;
begin
  if p_active is null or not (p_active = any (p_fx)) then
    raise exception 'mj_fx_grant：目前套用的特效要在開通的清單裡';
  end if;
  if p_expires <= v_now then
    raise exception 'mj_fx_grant：到期時間要在現在之後';
  end if;
  insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
  select p_user, f, p_actor, v_now, p_expires from (select distinct unnest(p_fx) as f) x;
  get diagnostics v_n = row_count;
  insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_active, v_now)
  on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_grant', p_user, jsonb_build_object('fx', to_jsonb(p_fx), 'active', p_active, 'expires_at', p_expires));
  return v_n;
end $$;

-- 收回：p_fx 為 null＝全部收回。只收回還有效的。回傳收回幾列（0 也寫操作紀錄）
create or replace function public.mj_fx_revoke(p_actor text, p_user text, p_fx text[], p_now timestamptz default null) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n int;
begin
  update mj_fx_grants set revoked_at = v_now, revoked_by = p_actor
  where user_id = p_user and revoked_at is null and expires_at > v_now and (p_fx is null or fx = any (p_fx));
  get diagnostics v_n = row_count;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_revoke', p_user, jsonb_build_object('fx', coalesce(to_jsonb(p_fx), '"all"'::jsonb), 'revoked', v_n));
  return v_n;
end $$;

-- 玩家自己換特效：p_permanent＝老闆帳號（6 種永久全開，伺服器判斷）；其他人要有還沒到期、沒收回的開通。回傳 true＝換成功
create or replace function public.mj_fx_select(p_user text, p_fx text, p_permanent boolean, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if not p_permanent and not exists (
    select 1 from mj_fx_grants where user_id = p_user and fx = p_fx and revoked_at is null and expires_at > v_now
  ) then
    return false;
  end if;
  insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_fx, v_now)
  on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail) values (v_now, p_user, 'fx_select', p_user, jsonb_build_object('fx', p_fx));
  return true;
end $$;

-- 胡牌時：這幾個帳號目前選用的特效，以及那一種的開通最晚到期時間（沒有有效開通＝null；老闆帳號由伺服器另外判斷永久有效）
create or replace function public.mj_zimo_fx_for(p_users text[], p_now timestamptz default null)
returns table (user_id text, fx text, until timestamptz)
language sql
stable
set search_path = public
as $$
  select p.user_id, p.fx,
    (select max(g.expires_at) from mj_fx_grants g
      where g.user_id = p.user_id and g.fx = p.fx and g.revoked_at is null and g.expires_at > coalesce(p_now, now()))
  from mj_fx_prefs p where p.user_id = any (p_users);
$$;

comment on table public.mj_donations is 'mj_zimo_fx:20261031';
comment on table public.mj_fx_grants is 'mj_zimo_fx:20261031';
comment on table public.mj_fx_prefs is 'mj_zimo_fx:20261031';
comment on table public.mj_fx_audit is 'mj_zimo_fx:20261031';
comment on function public.mj_zimo_fx_guard() is 'mj_zimo_fx:20261031';
comment on function public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz) is 'mj_zimo_fx:20261031';
comment on function public.mj_donation_void(text, uuid, text, timestamptz) is 'mj_zimo_fx:20261031';
comment on function public.mj_fx_grant(text, text, text[], text, timestamptz, timestamptz) is 'mj_zimo_fx:20261031';
comment on function public.mj_fx_revoke(text, text, text[], timestamptz) is 'mj_zimo_fx:20261031';
comment on function public.mj_fx_select(text, text, boolean, timestamptz) is 'mj_zimo_fx:20261031';
comment on function public.mj_zimo_fx_for(text[], timestamptz) is 'mj_zimo_fx:20261031';

-- 權限：只給 service_role。表只給 select、insert、update（刪除由觸發器擋，也不給 delete 權限）
do $$
declare
  t text;
  f text;
begin
  foreach t in array array['mj_donations', 'mj_fx_grants', 'mj_fx_prefs', 'mj_fx_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
  grant delete on table public.mj_fx_prefs to service_role; -- 偏好只是目前選哪一種，不是帳
  foreach f in array array[
    'public.mj_zimo_fx_guard()',
    'public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz)',
    'public.mj_donation_void(text, uuid, text, timestamptz)',
    'public.mj_fx_grant(text, text, text[], text, timestamptz, timestamptz)',
    'public.mj_fx_revoke(text, text, text[], timestamptz)',
    'public.mj_fx_select(text, text, boolean, timestamptz)',
    'public.mj_zimo_fx_for(text[], timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 自我檢查：公開金鑰對表（任何操作）、函式都不能有權限，表上不能有 policy；觸發器要在
do $$
declare
  r text;
  p text;
  t text;
  f record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['mj_donations', 'mj_fx_grants', 'mj_fx_prefs', 'mj_fx_audit'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) then
          raise exception '斗內／特效表鎖權限沒有完成：% 對 % 還有 %，整份不生效', r, t, p;
        end if;
      end loop;
    end loop;
    for f in select oid, proname from pg_proc where pronamespace = 'public'::regnamespace
             and obj_description(oid, 'pg_proc') = 'mj_zimo_fx:20261031' loop
      if has_function_privilege(r, f.oid, 'execute') then
        raise exception '斗內／特效函式鎖權限沒有完成：% 還能執行 %，整份不生效', r, f.proname;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('mj_donations', 'mj_fx_grants', 'mj_fx_prefs', 'mj_fx_audit')) then
    raise exception '斗內／特效表不應該有 policy，整份不生效';
  end if;
  if (select count(*) from pg_trigger where tgname in ('mj_donations_guard', 'mj_fx_grants_guard', 'mj_fx_audit_guard') and not tgisinternal) <> 3 then
    raise exception '斗內／特效的防刪改觸發器沒有建好，整份不生效';
  end if;
end $$;

commit;

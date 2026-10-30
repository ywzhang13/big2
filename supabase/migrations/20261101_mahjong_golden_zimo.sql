-- 全帳號的金色自摸預設（2026-11-01）。
-- 金色自摸不是可販售／可收回的特效：未選、未授權、授權到期或收回時都安全回退到它。
-- 只修改現有的 mj_fx_prefs 約束和兩支函式；不刪資料、不改帳本。
begin;

do $$
begin
  if to_regclass('public.mj_fx_prefs') is null
     or to_regprocedure('public.mj_fx_select(text,text,boolean,timestamp with time zone)') is null
     or to_regprocedure('public.mj_zimo_fx_for(text[],timestamp with time zone)') is null then
    raise exception '拒絕套用：請先套用 20261031_mahjong_zimo_fx.sql';
  end if;
end $$;

alter table public.mj_fx_prefs drop constraint if exists mj_fx_prefs_fx_check;
alter table public.mj_fx_prefs add constraint mj_fx_prefs_fx_check
  check (fx in ('golden', 'meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura'));

-- 金色自摸不必有 mj_fx_grants 紀錄；其他特效仍須有尚未到期且未收回的授權。
create or replace function public.mj_fx_select(p_user text, p_fx text, p_permanent boolean, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_fx <> 'golden' and not p_permanent and not exists (
    select 1 from mj_fx_grants where user_id = p_user and fx = p_fx and revoked_at is null and expires_at > v_now
  ) then
    return false;
  end if;
  insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_fx, v_now)
  on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_user, 'fx_select', p_user, jsonb_build_object('fx', p_fx));
  return true;
end $$;

-- 保留選用的 golden 列；它沒有授權期限，until 為 null。其餘代號仍只回傳目前有效的最晚授權期限。
create or replace function public.mj_zimo_fx_for(p_users text[], p_now timestamptz default null)
returns table (user_id text, fx text, until timestamptz)
language sql
stable
set search_path = public
as $$
  select p.user_id, p.fx,
    case when p.fx = 'golden' then null else (
      select max(g.expires_at) from mj_fx_grants g
        where g.user_id = p.user_id and g.fx = p.fx and g.revoked_at is null and g.expires_at > coalesce(p_now, now())
    ) end
  from mj_fx_prefs p where p.user_id = any (p_users);
$$;

commit;

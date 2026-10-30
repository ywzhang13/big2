-- 回滾 20261101 的金色自摸預設支援。
-- ⚠️ 會把目前選金色自摸的偏好刪除；回到舊程式時它們會走舊有的一般浮層規則。
begin;

delete from public.mj_fx_prefs where fx = 'golden';
alter table public.mj_fx_prefs drop constraint if exists mj_fx_prefs_fx_check;
alter table public.mj_fx_prefs add constraint mj_fx_prefs_fx_check
  check (fx in ('meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura'));

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

commit;

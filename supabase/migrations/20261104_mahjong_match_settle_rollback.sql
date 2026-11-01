-- 回滾 20261104_mahjong_match_settle.sql：函式改回套用前的版本，新函式拿掉。資料一筆都不刪、不改。
--   ・mj_donate_count、mj_donation_void、mj_fx_select、mj_zimo_fx_for、mj_fx_grant 改回原本的本體（20261102／20261101／20261031 的版本）
--   ・拿掉 mj_match_unsettled、mj_match_settled、mj_match_settle、mj_match_unsettle、mj_donation_tip、mj_match_zimo
--   ・mj_match_settlements 整張保留（含防刪觸發器）：裡面是老闆實際收錢的紀錄；結清時記的斗內也照樣算在斗內榜
--   ・操作紀錄不能刪也不能改：match_settle／match_unsettle 照樣留著，action 的檢查限制維持放寬
--   ⚠️ 回滾後斗內卡的次數改回舊的「歸零點＋還欠」算法：結清不會反映在舊算法裡（結清沒有動 mj_donate_acks），
--      所以結清過的人次數會變回 11/1 之後的全部自摸數。要回滾前先匯出 mj_match_settlements，必要時用舊的記一筆補抵扣
--   ⚠️ 特效改回「逐種開通」：只開過部分種類的人，回滾後只能用開過的那幾種
begin;

drop function if exists public.mj_match_unsettled(uuid);
drop function if exists public.mj_match_settled(uuid, timestamptz);
drop function if exists public.mj_match_settle(text, text, text, text, uuid[], int, timestamptz);
drop function if exists public.mj_match_unsettle(text, uuid, text, timestamptz);
drop function if exists public.mj_donation_tip(text, text, text, text, int, timestamptz, text, timestamptz);
drop function if exists public.mj_match_zimo(uuid[]);

create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce((select a.carried from mj_donate_acks a where a.user_id = p_user_id), 0)
    + (select count(*)::int from mj_zimo_wins w
       where w.user_id = p_user_id
         and w.won_at > coalesce((select a.acked_at from mj_donate_acks a where a.user_id = p_user_id), '-infinity'::timestamptz))
$$;

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

commit;

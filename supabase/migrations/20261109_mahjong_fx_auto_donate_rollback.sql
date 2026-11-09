-- 回滾 20261109_mahjong_fx_auto_donate.sql：拿掉自動開通／收回，mj_fx_grant／mj_fx_revoke／mj_donation_tip／
--   mj_match_settle／mj_donation_void／mj_match_unsettle 改回套用前（20261104）的本體。
--   mj_fx_auto_block 整張刪掉（只是「老闆手動收回過」的標記，不是帳目紀錄，刪了不影響任何斗內／開通紀錄）。
--   已經被自動開通／收回的那些 mj_fx_grants、mj_fx_audit 紀錄照樣留著（審伯 2026-11-02 必修 2 的慣例：紀錄不能刪）。
begin;

do $$
declare
  v_tbl oid := to_regclass('public.mj_fx_auto_block');
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from 'mj_fx_auto_block:20261109' then
    raise exception '拒絕回滾：public.mj_fx_auto_block 不是 20261109_mahjong_fx_auto_donate.sql 建的，不刪';
  end if;
end $$;

drop function if exists public.mj_fx_auto_sync(text, timestamptz);
drop table if exists public.mj_fx_auto_block;

create or replace function public.mj_fx_grant(p_actor text, p_user text, p_fx text[], p_active text, p_expires timestamptz, p_now timestamptz default null) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n int;
begin
  if p_active is not null and not (p_active = any (p_fx)) then
    raise exception 'mj_fx_grant：目前套用的特效要在開通的清單裡';
  end if;
  if p_expires <= v_now then
    raise exception 'mj_fx_grant：到期時間要在現在之後';
  end if;
  insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
  select p_user, f, p_actor, v_now, p_expires from (select distinct unnest(p_fx) as f) x;
  get diagnostics v_n = row_count;
  if p_active is not null then
    insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_active, v_now)
    on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_grant', p_user, jsonb_build_object('fx', to_jsonb(p_fx), 'active', p_active, 'expires_at', p_expires));
  return v_n;
end $$;

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

create or replace function public.mj_donation_tip(
  p_actor text, p_user text, p_name text, p_avatar text, p_amount int, p_donated_at timestamptz, p_note text, p_now timestamptz default null
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
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_add', p_user, v_id,
          jsonb_build_object('amount', p_amount, 'donated_at', p_donated_at, 'note', coalesce(p_note, ''), 'tip', p_amount, 'settle', false));
  return v_id;
end $$;

create or replace function public.mj_match_settle(
  p_actor text, p_user text, p_name text, p_avatar text, p_rooms uuid[], p_amount int default null, p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_user uuid := p_user::uuid;
  v_due int;
  v_amount int;
  v_rooms jsonb;
  v_codes text;
  v_id uuid;
  r record;
begin
  if p_rooms is null or cardinality(p_rooms) = 0 then return jsonb_build_object('error', 'no_rooms'); end if;
  if cardinality(p_rooms) <> (select count(distinct x) from unnest(p_rooms) x) then return jsonb_build_object('error', 'duplicate_room'); end if;
  perform pg_advisory_xact_lock(hashtext('mj_match_settle:' || p_user));

  for r in
    select x.room_id, u.ended_at, u.zimo
    from unnest(p_rooms) as x(room_id) left join public.mj_match_unsettled(v_user) u on u.room_id = x.room_id
  loop
    if r.zimo is null then
      if exists (select 1 from mj_match_settlements s where s.room_id = r.room_id and s.user_id = v_user and s.revoked_at is null) then
        return jsonb_build_object('error', 'already_settled', 'roomId', r.room_id);
      end if;
      return jsonb_build_object('error', 'nothing_due', 'roomId', r.room_id);
    end if;
    if r.ended_at is null then
      return jsonb_build_object('error', 'not_finished', 'roomId', r.room_id);
    end if;
  end loop;
  select sum(u.due)::int, jsonb_agg(jsonb_build_object('roomId', u.room_id, 'roomCode', u.room_code, 'zimo', u.zimo, 'due', u.due) order by u.ended_at),
         string_agg('房 ' || u.room_code, '、' order by u.ended_at)
    into v_due, v_rooms, v_codes
  from public.mj_match_unsettled(v_user) u where u.room_id = any (p_rooms);

  v_amount := coalesce(p_amount, v_due);
  if v_amount < 1 or v_amount > 999999 then return jsonb_build_object('error', 'bad_amount'); end if;
  if v_amount < v_due then
    return jsonb_build_object('error', 'short', 'due', v_due, 'amount', v_amount, 'shortBy', v_due - v_amount);
  end if;

  insert into mj_donations (user_id, player_name, player_avatar, amount, donated_at, note, created_by, created_at)
  values (p_user, p_name, p_avatar, v_amount, v_now, left('結清 ' || v_codes, 200), p_actor, v_now)
  returning id into v_id;
  insert into mj_match_settlements (room_id, user_id, zimo_count, due, donation_id, source, settled_by, settled_at)
  select (e ->> 'roomId')::uuid, v_user, (e ->> 'zimo')::int, (e ->> 'due')::int, v_id, 'settle', p_actor, v_now
  from jsonb_array_elements(v_rooms) e;
  update mj_donate_acks a set seen_count = least(a.seen_count, public.mj_donate_count(v_user)) where a.user_id = v_user;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'match_settle', p_user, v_id,
          jsonb_build_object('rooms', v_rooms, 'due', v_due, 'amount', v_amount, 'tip', v_amount - v_due, 'price', 10));
  return jsonb_build_object('donationId', v_id, 'due', v_due, 'amount', v_amount, 'tip', v_amount - v_due, 'rooms', v_rooms);
end $$;

create or replace function public.mj_donation_void(p_actor text, p_id uuid, p_reason text, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_row mj_donations%rowtype;
begin
  if exists (select 1 from mj_match_settlements s where s.donation_id = p_id and s.revoked_at is null) then
    return false;
  end if;
  update mj_donations set voided_at = v_now, voided_by = p_actor, void_reason = p_reason
  where id = p_id and voided_at is null
  returning * into v_row;
  if not found then return false; end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_void', v_row.user_id, p_id, jsonb_build_object('amount', v_row.amount, 'reason', p_reason));
  return true;
end $$;

create or replace function public.mj_match_unsettle(p_actor text, p_donation uuid, p_reason text, p_now timestamptz default null) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_user uuid;
  v_rooms jsonb;
  v_amount int;
begin
  select s.user_id into v_user from mj_match_settlements s where s.donation_id = p_donation and s.revoked_at is null limit 1;
  if v_user is null then return jsonb_build_object('error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('mj_match_settle:' || v_user::text));
  with done as (
    update mj_match_settlements s set revoked_at = v_now, revoked_by = p_actor, revoke_reason = left(p_reason, 200)
    where s.donation_id = p_donation and s.revoked_at is null
    returning s.room_id, s.zimo_count, s.due
  )
  select jsonb_agg(jsonb_build_object('roomId', d.room_id, 'roomCode', m.room_code, 'zimo', d.zimo_count, 'due', d.due) order by m.ended_at)
    into v_rooms from done d left join match_records m on m.game = 'mahjong' and m.room_id = d.room_id;
  if v_rooms is null then return jsonb_build_object('error', 'not_found'); end if;
  update mj_donations set voided_at = v_now, voided_by = p_actor, void_reason = left('撤回結清：' || coalesce(p_reason, ''), 200)
  where id = p_donation and voided_at is null
  returning amount into v_amount;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'match_unsettle', v_user::text, p_donation,
          jsonb_build_object('rooms', v_rooms, 'amount', v_amount, 'donation_voided', v_amount is not null, 'reason', p_reason));
  return jsonb_build_object('donationId', p_donation, 'amount', v_amount, 'rooms', v_rooms);
end $$;

commit;

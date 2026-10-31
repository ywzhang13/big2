-- 回滾 20261102_mahjong_donate_deduct.sql：拿掉新函式、把 mj_donate_count／mj_donation_add 改回原本（記一筆＝歸零），拿掉 4 個新欄位。
-- ⚠️ 會丟掉「還欠的次數」（carried）和「看過幾次」（seen_count）：回滾後每個人的次數＝上次歸零點之後的自摸次數。
--    記過部分斗內、還有剩的人，回滾前先匯出 mj_donate_acks（select user_id, carried, seen_count from mj_donate_acks where carried > 0）。
-- 操作紀錄不能刪也不能改：已經有 zimo_clear 紀錄時，action 檢查維持放寬（不改回舊的），其他照樣回滾。
-- 新函式只刪有標記 'mj_donate_deduct:20261102' 的；可以重跑。
begin;

do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('mj_donation_record', 'mj_zimo_clear', 'mj_donate_seen', 'mj_donate_status', 'mj_zimo_counts', 'mj_donate_settle')
             and obj_description(oid, 'pg_proc') is distinct from 'mj_donate_deduct:20261102') then
    raise exception '拒絕回滾：新函式不是 20261102_mahjong_donate_deduct.sql 建的，不刪';
  end if;
end $$;

-- 改回 20261021 的次數：歸零點之後的自摸
create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from mj_zimo_wins w
  where w.user_id = p_user_id
    and w.won_at > coalesce((select a.acked_at from mj_donate_acks a where a.user_id = p_user_id), '-infinity'::timestamptz)
$$;

-- 改回 20261031 的記一筆：連同操作紀錄，把歸零點設成現在
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

drop function if exists public.mj_donation_record(text, text, text, text, int, timestamptz, text, timestamptz);
drop function if exists public.mj_zimo_clear(text, text, timestamptz);
drop function if exists public.mj_donate_seen(uuid, int);
drop function if exists public.mj_donate_status(uuid);
drop function if exists public.mj_zimo_counts();
drop function if exists public.mj_donate_settle(uuid, int, text, timestamptz);

alter table public.mj_donate_acks drop constraint if exists mj_donate_acks_deduct_check;
alter table public.mj_donate_acks drop column if exists carried, drop column if exists seen_count,
  drop column if exists reset_source, drop column if exists reset_cleared;

do $$
begin
  if not exists (select 1 from public.mj_fx_audit where action = 'zimo_clear') then
    alter table public.mj_fx_audit drop constraint if exists mj_fx_audit_action_check;
    alter table public.mj_fx_audit add constraint mj_fx_audit_action_check
      check (action in ('donation_add', 'donation_void', 'fx_grant', 'fx_revoke', 'fx_select'));
  end if;
end $$;

commit;

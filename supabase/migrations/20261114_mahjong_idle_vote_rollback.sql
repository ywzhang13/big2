-- 回滾 20261114_mahjong_idle_vote.sql：刪掉 mj_leave_dissolve，mj_chat_take、mj_effect_take 換回原本的定義（20261023／20261021，一字不改）。
-- 回滾前請先把程式退回不呼叫 mj_leave_dissolve 的版本。函式的註解標記（mj_chat:20261023、mj_effects:20261021）不受影響。
begin;
drop function if exists public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz);

create or replace function public.mj_chat_take(
  p_room_id text,
  p_user_id text,
  p_kind text,
  p_cooldown_ms int,
  p_burst_count int,
  p_burst_window_ms int,
  p_burst_cooldown_ms int,
  p_commit boolean,
  p_now timestamptz default null
) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_times timestamptz[];
  v_n int;
  v_cd int := p_cooldown_ms;
  v_wait int;
  v_keep int := greatest(p_burst_count, 1);
begin
  if p_kind not in ('text', 'voice') then
    raise exception 'mj_chat_take：未知的訊息種類 %', p_kind;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mj_chat:' || p_room_id || ':' || p_user_id || ':' || p_kind, 0));

  select sent_at into v_times from mj_chat_rate
  where room_id = p_room_id and user_id = p_user_id and kind = p_kind;
  v_n := coalesce(array_length(v_times, 1), 0);
  if v_n > 0 then
    if p_burst_count > 1 and v_n >= p_burst_count
       and v_times[v_n] - v_times[v_n - p_burst_count + 1] <= make_interval(secs => p_burst_window_ms / 1000.0) then
      v_cd := p_burst_cooldown_ms;
    end if;
    v_wait := ceil(v_cd - extract(epoch from (v_now - v_times[v_n])) * 1000)::int;
    if v_wait > 0 then
      return v_wait;
    end if;
  end if;
  if not p_commit then
    return 0;
  end if;

  v_times := coalesce(v_times, '{}') || v_now;
  v_n := array_length(v_times, 1);
  if v_n > v_keep then
    v_times := v_times[v_n - v_keep + 1 : v_n];
  end if;
  insert into mj_chat_rate (room_id, user_id, kind, sent_at, last_at) values (p_room_id, p_user_id, p_kind, v_times, v_now)
  on conflict (room_id, user_id, kind) do update set sent_at = excluded.sent_at, last_at = excluded.last_at;
  delete from mj_chat_rate where last_at < v_now - interval '1 day';
  return 0;
end $$;

create or replace function public.mj_effect_take(
  p_room_id text,
  p_sender_id text,
  p_target_id text,
  p_group text,
  p_cooldown_ms int,
  p_protect_ms int,
  p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_send_slot text := 'send_' || p_group;
  v_protect boolean := p_protect_ms > 0;
  v_send_last timestamptz;
  v_recv_last timestamptz;
  v_wait int;
  v_key bigint;
begin
  if p_group not in ('light', 'heavy') then
    raise exception 'mj_effect_take：未知的組別 %', p_group;
  end if;
  if p_sender_id = p_target_id then
    raise exception 'mj_effect_take：發送者和目標不能是同一人';
  end if;

  -- 取鎖：鎖編號由 'mj_effect:<房>:<人>:<位子>' 算出，依編號由小到大取（固定順序，不會死結）
  foreach v_key in array (
    select array_agg(k order by k) from unnest(array[
      hashtextextended('mj_effect:' || p_room_id || ':' || p_sender_id || ':' || v_send_slot, 0),
      case when v_protect then hashtextextended('mj_effect:' || p_room_id || ':' || p_target_id || ':recv_heavy', 0) end
    ]) as k where k is not null
  ) loop
    perform pg_advisory_xact_lock(v_key);
  end loop;

  select last_at into v_send_last from mj_effect_rate
  where room_id = p_room_id and subject_id = p_sender_id and slot = v_send_slot;
  if v_protect then
    select last_at into v_recv_last from mj_effect_rate
    where room_id = p_room_id and subject_id = p_target_id and slot = 'recv_heavy';
  end if;

  if v_send_last is not null then
    v_wait := ceil(p_cooldown_ms - extract(epoch from (v_now - v_send_last)) * 1000)::int;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_ms', v_wait);
    end if;
  end if;
  if v_protect and v_recv_last is not null then
    v_wait := ceil(p_protect_ms - extract(epoch from (v_now - v_recv_last)) * 1000)::int;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'reason', 'target_protected', 'retry_after_ms', v_wait);
    end if;
  end if;

  -- 通過了才寫入（同一個交易，兩筆一起成功或一起不成功）
  insert into mj_effect_rate (room_id, subject_id, slot, last_at) values (p_room_id, p_sender_id, v_send_slot, v_now)
  on conflict (room_id, subject_id, slot) do update set last_at = excluded.last_at;
  if v_protect then
    insert into mj_effect_rate (room_id, subject_id, slot, last_at) values (p_room_id, p_target_id, 'recv_heavy', v_now)
    on conflict (room_id, subject_id, slot) do update set last_at = excluded.last_at;
  end if;
  delete from mj_effect_rate where last_at < v_now - interval '1 day';
  return jsonb_build_object('ok', true);
end $$;

commit;

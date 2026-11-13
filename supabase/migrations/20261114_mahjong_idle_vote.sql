-- 麻將解散投票：閒置不計票的原子保護（審伯 2026-11-13 必修 2）
-- 問題：判斷誰閒置要看聊天、互動的時間，但聊天、互動不更新牌局版本，所以「讀時間 → 解散存檔」中間如果有人剛好聊天，版本鎖抓不到。
-- 做法：讓「解散」和「聊天／互動記錄」搶同一把鎖——mj_rooms 那一列：
--   ① mj_leave_dissolve()：排他鎖住房間那一列 → 再查一次「被當成閒置的人」在判斷時間之後有沒有聊天／互動 →
--      有就不解散（回 'activity'，伺服器重新判斷、把他算進來）；沒有就在同一個交易裡呼叫既有的 close_room_with_record（寫紀錄＋刪房）
--   ② mj_chat_take()、mj_effect_take()：開頭加「共享鎖住房間那一列；房間不在就擋下」，其餘邏輯一字不改
--      ・聊天／互動先：它拿著共享鎖直到交易結束，解散要等它寫完，再查就看得到 → 不解散
--      ・解散先：它拿著排他鎖直到刪房結束，聊天／互動要等，等到時房間已經不在 → 擋下，不寫任何紀錄
-- 被擋下時的回傳（房間已經關了，前端會收到房間關閉事件）：聊天回 60000（60 秒冷卻）；互動回 cooldown 60 秒。
-- 回滾見 20261114_mahjong_idle_vote_rollback.sql（把兩個函式換回原本的定義、刪掉 mj_leave_dissolve）。
-- ⚠️ 和聊天分支 feat/mj-chat-history 的關係：那邊的 mj_chat_post 會先呼叫 mj_chat_lock_room（advisory lock＋共享鎖房間列）再呼叫 mj_chat_take；
--    兩邊都只拿共享鎖，可以並存，不會死結。合併時兩份 migration 都要套，順序不拘。
begin;

do $$
begin
  if to_regprocedure('public.close_room_with_record(text, uuid, jsonb, bigint, int)') is null then
    raise exception '拒絕套用：找不到 close_room_with_record（20261016／20261017）';
  end if;
  if to_regprocedure('public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)') is null then
    raise exception '拒絕套用：找不到 mj_chat_take（20261023）';
  end if;
  if to_regprocedure('public.mj_effect_take(text, text, text, text, int, int, timestamptz)') is null then
    raise exception '拒絕套用：找不到 mj_effect_take（20261021）';
  end if;
  if to_regprocedure('public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz)') is not null then
    raise exception '拒絕套用：mj_leave_dissolve 已經存在（已經套用過？）';
  end if;
end $$;

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
  -- 【20261114 解散投票】先用「共享鎖」鎖住房間那一列：解散（mj_leave_dissolve 用排他鎖）進行中就排隊等它；
  -- 房間已經不在（剛被解散、關房）就不記、直接擋下（回 60 秒冷卻，前端收到房間關閉事件就會離開）
  perform 1 from mj_rooms where id::text = p_room_id for share;
  if not found then
    return 60000;
  end if;
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
  -- 【20261114 解散投票】先用「共享鎖」鎖住房間那一列：解散（mj_leave_dissolve 用排他鎖）進行中就排隊等它；
  -- 房間已經不在（剛被解散、關房）就不記、直接擋下（回冷卻 60 秒，前端收到房間關閉事件就會離開）
  perform 1 from mj_rooms where id::text = p_room_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_ms', 60000);
  end if;
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

create function public.mj_leave_dissolve(
  p_room uuid,
  p_record jsonb,
  p_expected_version int,
  p_idle_users text[],
  p_cutoff timestamptz
) returns text
language plpgsql
set search_path = public
as $$
begin
  perform 1 from mj_rooms where id = p_room for update; -- 排他鎖：聊天、互動記錄（共享鎖）要等這裡結束
  if not found then
    return 'not_found';
  end if;
  -- 被當成閒置的人：判斷時間之後只要聊過天或丟過互動，就不能把他排除
  if exists (select 1 from mj_chat_rate where room_id = p_room::text and user_id = any(p_idle_users) and last_at >= p_cutoff)
     or exists (select 1 from mj_effect_rate where room_id = p_room::text and subject_id = any(p_idle_users)
                and slot in ('send_light', 'send_heavy') and last_at >= p_cutoff) then
    return 'activity';
  end if;
  return close_room_with_record('mahjong', p_room, p_record, null, p_expected_version); -- closed／changed／not_found／already_closed
end
$$;
comment on function public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz) is 'mj_idle_vote:20261114';
revoke all on function public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz)', 'execute') then
    raise exception '解散函式鎖權限沒有完成，整份不生效';
  end if;
end $$;

commit;

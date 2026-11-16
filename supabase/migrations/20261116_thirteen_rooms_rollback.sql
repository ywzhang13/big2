-- 回滾 20261116_thirteen_rooms.sql（老柯 2026-11-16）
-- 順序：先把正式站程式退回不含十三支的版本，再跑這份。
-- 為了不默默刪掉資料：還有任何十三支房間、或已經寫過十三支對局紀錄時，整份拒絕執行（什麼都不改），
-- 要先確認那些資料可以處理掉（例如手動匯出後刪除）再跑。
-- 做的事（同一個交易）：close_room_with_record 換回 20261017_mahjong_login.sql 的定義（一字不差）、
-- match_records.game 的限制改回只有 mahjong、big2、刪掉 th_players、th_rooms。
begin;

do $$
begin
  if to_regclass('public.th_rooms') is not null and exists (select 1 from public.th_rooms) then
    raise exception '拒絕回滾：還有十三支房間（th_rooms），請先確認沒有進行中的牌局並處理掉這些房間';
  end if;
  if exists (select 1 from public.match_records where game = 'thirteen') then
    raise exception '拒絕回滾：已經有十三支對局紀錄（match_records.game = thirteen），刪掉會遺失玩家戰績';
  end if;
end $$;

-- 換回 20261017_mahjong_login.sql 的定義（參數、回傳、權限都不變）
create or replace function close_room_with_record(
  p_game text,
  p_room_id uuid,
  p_record jsonb default null,
  p_expected_row_version bigint default null,
  p_expected_version int default null
) returns text
language plpgsql
as $$
declare
  v_row_version bigint;
  v_version int;
  v_match_id uuid;
begin
  if p_game = 'mahjong' then
    select row_version, nullif(game_state->>'stateVersion', '')::int
      into v_row_version, v_version
      from mj_rooms where id = p_room_id
      for update;                              -- 鎖住這間房：同時進來的動作要等這裡做完
  elsif p_game = 'big2' then
    select row_version into v_row_version from big2_rooms where id = p_room_id for update;
  else
    raise exception 'unknown game %', p_game;
  end if;

  if not found then
    if exists (select 1 from match_records where game = p_game and room_id = p_room_id) then
      return 'already_closed';
    end if;
    return 'not_found';
  end if;

  if (p_expected_row_version is not null and v_row_version is distinct from p_expected_row_version)
     or (p_expected_version is not null and v_version is distinct from p_expected_version) then
    return 'changed';
  end if;

  if p_record is not null then
    insert into match_records (game, room_id, room_code, started_at, end_reason,
                               total_rounds, base_points, fan_points, settings, hands_played)
    values (p_game, p_room_id, p_record->>'room_code', (p_record->>'started_at')::timestamptz,
            p_record->>'end_reason', (p_record->>'total_rounds')::int, (p_record->>'base_points')::int,
            (p_record->>'fan_points')::int, coalesce(p_record->'settings', '{}'::jsonb),
            (p_record->>'hands_played')::int)
    on conflict (game, room_id) do nothing
    returning id into v_match_id;
    if v_match_id is null then
      select id into v_match_id from match_records where game = p_game and room_id = p_room_id;
    end if;
    insert into match_record_players (match_id, seat, player_name, player_id, total_score, user_id)
    select v_match_id, (p->>'seat')::int, p->>'player_name', p->>'player_id', (p->>'total_score')::int,
           nullif(p->>'user_id', '')::uuid      -- 登入房：LINE 登入的使用者；沒登入／大老二＝null
      from jsonb_array_elements(p_record->'players') as p
    on conflict (match_id, seat) do nothing;
  end if;

  if p_game = 'mahjong' then
    delete from mj_rooms where id = p_room_id;     -- mj_players 會 cascade 刪掉
  else
    delete from big2_rooms where id = p_room_id;   -- big2_players 會 cascade 刪掉
  end if;
  return 'closed';
end $$;

alter table public.match_records drop constraint match_records_game_check;
alter table public.match_records add constraint match_records_game_check check (game in ('mahjong', 'big2'));

drop table if exists public.th_players;
drop table if exists public.th_rooms;   -- trigger、index 跟著刪

commit;

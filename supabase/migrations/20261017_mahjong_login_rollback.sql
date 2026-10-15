-- 回滾 20261017_mahjong_login.sql：close_room_with_record 退回不寫 user_id 的版本、移除 mj_players.user_id。
-- 順序：先把程式退回上一版（f85aa16），再跑這份；新程式在 user_id 欄位不見後無法加入房間。
-- 已寫進 match_record_players.user_id 的值不會被刪（那一欄是 20261016 建的）。
begin;

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
    insert into match_record_players (match_id, seat, player_name, player_id, total_score)
    select v_match_id, (p->>'seat')::int, p->>'player_name', p->>'player_id', (p->>'total_score')::int
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

alter table mj_players drop column if exists user_id;

commit;

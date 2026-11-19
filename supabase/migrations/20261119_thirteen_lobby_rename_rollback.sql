-- 回滾 20261119_thirteen_lobby_rename.sql：th_lobby_join 換回 20261118_thirteen_lobby.sql 的原文（等人階段重新加入不改名）。
-- 不動任何資料：已經改過的名字留著。先把程式退回再跑這份也可以，舊程式不看 renamed。
begin;

create or replace function public.th_lobby_join(p_room_id uuid, p_player_id text, p_name text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_room th_rooms%rowtype;
  v_mine th_players%rowtype;
  v_seat int;
  v_ver int;
begin
  select * into v_room from th_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('error', 'room_not_found');
  end if;
  select * into v_mine from th_players where room_id = p_room_id and user_id = p_user_id order by created_at limit 1;
  if found then
    return jsonb_build_object('ok', true, 'rejoined', true, 'seat', v_mine.seat, 'player_id', v_mine.player_id);
  end if;
  if v_room.status <> 'waiting' then
    return jsonb_build_object('error', 'started');
  end if;
  if (select count(*) from th_players where room_id = p_room_id) >= 4 then
    return jsonb_build_object('error', 'full');
  end if;
  if exists (select 1 from th_players where room_id = p_room_id and player_id = p_player_id) then
    return jsonb_build_object('error', 'player_taken');
  end if;
  -- 房主的座位只有房主帳號能坐（房主離開交接後，換成新房主的座位和帳號）
  if p_player_id = v_room.host_id and (v_room.game_state->>'hostUserId') is distinct from p_user_id::text then
    return jsonb_build_object('error', 'host_reserved');
  end if;
  select min(s) into v_seat from generate_series(0, 3) s
   where not exists (select 1 from th_players where room_id = p_room_id and seat = s);
  insert into th_players (room_id, player_id, name, seat, user_id) values (p_room_id, p_player_id, p_name, v_seat, p_user_id);
  v_ver := coalesce((v_room.game_state->>'stateVersion')::int, 0) + 1;
  update th_rooms set game_state = jsonb_set(coalesce(game_state, '{}'::jsonb), '{stateVersion}', to_jsonb(v_ver)) where id = p_room_id;
  return jsonb_build_object('ok', true, 'rejoined', false, 'seat', v_seat, 'player_id', p_player_id, 'state_version', v_ver);
end $$;

comment on function public.th_lobby_join(uuid, text, text, uuid) is 'th_lobby:20261118';

commit;

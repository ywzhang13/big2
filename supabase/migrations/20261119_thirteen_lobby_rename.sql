-- 十三支等人階段重新加入改名（老柯 2026-11-19，配合共用開房流程；小宜設計說明 v1.1 第 4-3 節）。
-- 只換 th_lobby_join 一個函式（create or replace，參數、權限不變；th_lobby_leave 不動）：
--   同一個帳號已經坐在這房、房間還在等人、名字和這次送來的不同 → 換名字、牌局版本 +1，回 { ok, rejoined:true, renamed:true, seat, player_id, state_version }
--   已經開打 → 照舊不換名字，回 { ok, rejoined:true, seat, player_id }
--   其他情況（新入座、房滿、已開打不能加入…）和 20261118 完全一樣
-- 名字長度（去掉前後空白 1～8 個字）由伺服器路由檢查（app/api/thirteen/join/route.ts），這裡不重複檢查。
-- 回滾：20261119_thirteen_lobby_rename_rollback.sql（換回 20261118 原文）。
begin;

do $$
begin
  if to_regprocedure('public.th_lobby_join(uuid, text, text, uuid)') is null then
    raise exception '拒絕套用：找不到 th_lobby_join，請先套用 20261118_thirteen_lobby.sql';
  end if;
end $$;

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
    -- 共用開房流程（2026-11-19）：還在等人時重新加入，名字換成這次送來的，牌局版本 +1（同桌重抓就看到新名字）；
    -- 已經開打就不換（這一場的名牌、對局紀錄用開打時的名字，新名字下一場才用）
    if v_room.status = 'waiting' and v_mine.name is distinct from p_name then
      update th_players set name = p_name where id = v_mine.id;
      v_ver := coalesce((v_room.game_state->>'stateVersion')::int, 0) + 1;
      update th_rooms set game_state = jsonb_set(coalesce(game_state, '{}'::jsonb), '{stateVersion}', to_jsonb(v_ver)) where id = p_room_id;
      return jsonb_build_object('ok', true, 'rejoined', true, 'renamed', true, 'seat', v_mine.seat, 'player_id', v_mine.player_id, 'state_version', v_ver);
    end if;
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

comment on function public.th_lobby_join(uuid, text, text, uuid) is 'th_lobby:20261119';

commit;

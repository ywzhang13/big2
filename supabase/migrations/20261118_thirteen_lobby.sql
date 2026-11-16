-- 十三支等人階段的入座、離開（老柯 2026-11-18，審伯必修 1～3）：兩個函式，各自在同一個交易裡「鎖房間那一列 → 檢查 → 改座位 → 改房間」。
-- 為什麼要放進資料庫：入座、離開、開局、空房關閉、閒置清除如果分成好幾次寫入，中間的空檔會讓彼此交錯——
--   ・最後一人離開後、關房前有人入座 → 新入座的人跟著房間被刪掉，或房主沒交接、沒人能開局（必修 1）
--   ・入座不更新房間 → 閒置清除拿舊快照照樣把有人坐的房刪掉（必修 2）
--   ・離開刪座位後、補回前有人補位或開局 → 牌局玩家和座位表對不上，補回時的 duplicate 被忽略（必修 3）
-- 鎖住房間那一列（for update）之後才讀座位、做決定，同一間房的入座、離開、開局存檔、關房、清除都要排隊，不會交錯。
--
--   th_lobby_join(房間, playerId, 名字, 帳號) → jsonb
--     已經坐在這房（同帳號）→ {ok, rejoined:true, seat, player_id}（不改任何東西，開局後也適用）
--     否則要還在等人：{error:'room_not_found'|'started'|'full'|'player_taken'|'host_reserved'}
--     成功：坐最小的空位、牌局版本 +1（trigger 一併更新 updated_at、row_version → 舊的閒置清除快照失效）→ {ok, rejoined:false, seat, player_id, state_version}
--   th_lobby_leave(房間, 帳號) → jsonb
--     {error:'not_in_room'|'game_in_progress'}
--     成功：刪座位；房裡還有人 → 房主離開就交給最早入座的人（host_id、game_state.hostUserId 一起換），版本 +1
--           → {ok, closed:false, host_id, player_id, seat, player_count, state_version}
--           房裡沒人了 → 直接刪房（一局都沒打，不寫紀錄；同 close_room_with_record 不帶紀錄）→ {ok, closed:true, host_id:null, player_id, seat}
-- 權限：只有 service_role（伺服器路由）能執行。回滾：20261118_thirteen_lobby_rollback.sql。
begin;

do $$
begin
  if to_regclass('public.th_rooms') is null or to_regclass('public.th_players') is null then
    raise exception '拒絕套用：找不到 th_rooms／th_players，請先套用 20261116_thirteen_rooms.sql';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('th_lobby_join', 'th_lobby_leave')
             and obj_description(oid, 'pg_proc') is distinct from 'th_lobby:20261118') then
    raise exception '拒絕套用：th_lobby_join／th_lobby_leave 已經存在，而且不是這份 migration 建的';
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

create or replace function public.th_lobby_leave(p_room_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_room th_rooms%rowtype;
  v_mine th_players%rowtype;
  v_next th_players%rowtype;
  v_host text;
  v_gs jsonb;
  v_ver int;
  v_n int;
begin
  select * into v_room from th_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('error', 'not_in_room');
  end if;
  select * into v_mine from th_players where room_id = p_room_id and user_id = p_user_id order by created_at limit 1;
  if not found then
    return jsonb_build_object('error', 'not_in_room');
  end if;
  if v_room.status <> 'waiting' then
    return jsonb_build_object('error', 'game_in_progress');
  end if;
  delete from th_players where id = v_mine.id;
  select * into v_next from th_players where room_id = p_room_id order by created_at, id limit 1;
  if not found then
    delete from th_rooms where id = p_room_id;
    return jsonb_build_object('ok', true, 'closed', true, 'host_id', null, 'player_id', v_mine.player_id, 'seat', v_mine.seat);
  end if;
  v_gs := coalesce(v_room.game_state, '{}'::jsonb);
  v_host := v_room.host_id;
  if v_room.host_id is not distinct from v_mine.player_id then
    v_host := v_next.player_id;
    v_gs := jsonb_set(v_gs, '{hostUserId}', coalesce(to_jsonb(v_next.user_id::text), 'null'::jsonb));
  end if;
  v_ver := coalesce((v_gs->>'stateVersion')::int, 0) + 1;
  update th_rooms set host_id = v_host, game_state = jsonb_set(v_gs, '{stateVersion}', to_jsonb(v_ver)) where id = p_room_id;
  select count(*) into v_n from th_players where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'closed', false, 'host_id', v_host, 'player_id', v_mine.player_id, 'seat', v_mine.seat,
    'player_count', v_n, 'state_version', v_ver);
end $$;

comment on function public.th_lobby_join(uuid, text, text, uuid) is 'th_lobby:20261118';
comment on function public.th_lobby_leave(uuid, uuid) is 'th_lobby:20261118';
revoke all on function public.th_lobby_join(uuid, text, text, uuid), public.th_lobby_leave(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.th_lobby_join(uuid, text, text, uuid), public.th_lobby_leave(uuid, uuid) from anon, authenticated;
    grant execute on function public.th_lobby_join(uuid, text, text, uuid), public.th_lobby_leave(uuid, uuid) to service_role;
  end if;
end $$;

commit;

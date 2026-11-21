-- 麻將等人時改名（老柯 2026-11-20；審伯複核麻將共用開房 R1）：改名和開局要有先後，不能交錯。
-- 新增一個函式 mj_lobby_rename(房間, 玩家, 新名字)，在同一個交易裡：
--   1. 鎖住這間房（select … for update），開局的條件寫入會排在後面等
--   2. 房間不是 waiting（已經開局）→ 不改，回 'started'
--   3. 座位名字一樣 → 不改，回 'same'；不在這間房 → 'not_seated'；房間不在 → 'not_found'
--   4. 改座位名字，並把等人階段的版本（game_state.stateVersion）加 1，回 'renamed' 和新的 game_state
-- 開局（發牌）存檔是「版本對得上才寫」：改名先成功 → 開局那次撞到版本、重讀，牌局裡用新名字；開局先成功 → 改名回 started，不改不廣播。
-- 不改任何資料表、不動現有資料。只有伺服器（service_role）能呼叫。回滾：20261120_mj_lobby_rename_rollback.sql（刪掉這個函式）。
begin;

do $$
begin
  if to_regclass('public.mj_rooms') is null or to_regclass('public.mj_players') is null then
    raise exception '拒絕套用：找不到 mj_rooms／mj_players';
  end if;
end $$;

create or replace function public.mj_lobby_rename(p_room_id uuid, p_player_id text, p_name text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_gs jsonb;
  v_old text;
  v_ver int;
begin
  select status, game_state into v_status, v_gs from mj_rooms where id = p_room_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_status <> 'waiting' then return jsonb_build_object('result', 'started'); end if;
  select name into v_old from mj_players where room_id = p_room_id and player_id = p_player_id;
  if not found then return jsonb_build_object('result', 'not_seated'); end if;
  if v_old = p_name then return jsonb_build_object('result', 'same'); end if;
  update mj_players set name = p_name where room_id = p_room_id and player_id = p_player_id;
  v_ver := coalesce((v_gs->>'stateVersion')::int, 0) + 1;
  v_gs := coalesce(v_gs, '{}'::jsonb) || jsonb_build_object('stateVersion', v_ver);
  update mj_rooms set game_state = v_gs where id = p_room_id;
  return jsonb_build_object('result', 'renamed', 'game_state', v_gs);
end;
$$;

revoke all on function public.mj_lobby_rename(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mj_lobby_rename(uuid, text, text) to service_role;
comment on function public.mj_lobby_rename(uuid, text, text) is 'mj_lobby_rename:20261120';

commit;

-- 十三支（4 人加一色）房間與對局紀錄（老柯 2026-11-16）
-- 只新增或擴充，不改也不刪既有資料；麻將、大老二的行為一字不變。
-- 回滾：20261116_thirteen_rooms_rollback.sql（要先把程式退回不含十三支的版本）。
--
-- 做的事（整份同一個交易，失敗就全部不生效）：
--   ① 新表 th_rooms、th_players：照 mj_rooms／mj_players 的欄位（含 updated_at、row_version、user_id），
--      用同一個 games_touch_room trigger 自動填最後活動時間和異動次數
--   ② 權限照麻將鎖好的樣子：開 RLS、不建任何 policy，收回 PUBLIC／anon／authenticated 的全部權限，只有 service_role 能讀寫
--   ③ match_records.game 的限制加上 'thirteen'（原本只有 mahjong、big2）
--   ④ close_room_with_record 多一個 'thirteen' 分支：鎖住 th_rooms 那一列、比對版本、寫紀錄、刪房（th_players 跟著 cascade 刪）。
--      參數、回傳、權限都不變；mahjong、big2 兩個分支和其他每一行照抄 20261017_mahjong_login.sql 的最新定義
--
-- 牌局狀態（4 家手牌、理牌截止時間、各家送出的三墩、每局結果、多局累計）都放在 th_rooms.game_state（jsonb），
-- 格式見 lib/thirteen/db.ts 的 ThirteenGameState；開房設定（理牌時間 30／45／60 秒、局數）也在裡面，資料表不另開欄位。
begin;

do $$
begin
  if to_regclass('public.match_records') is null or to_regprocedure('public.games_touch_room()') is null then
    raise exception '拒絕套用：找不到 match_records 或 games_touch_room，請先套用 20261016_match_records.sql';
  end if;
  if to_regclass('public.th_rooms') is not null or to_regclass('public.th_players') is not null then
    raise exception '拒絕套用：th_rooms／th_players 已經存在（這份已經套用過）';
  end if;
end $$;

-- ① 房間與座位
create table public.th_rooms (
  id uuid primary key default gen_random_uuid(),
  code char(4) unique not null,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  host_id text,
  game_state jsonb,                                 -- ThirteenGameState（lib/thirteen/db.ts）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),    -- trigger 自動填：閒置多久
  row_version bigint not null default 0             -- trigger 每次更新 +1：選中之後有沒有人動過
);
create index th_rooms_status_updated on public.th_rooms (status, updated_at);

create table public.th_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.th_rooms(id) on delete cascade,
  player_id text not null,
  name text not null,
  seat int not null check (seat between 0 and 3),
  user_id uuid,                                     -- 這個座位的 LINE 登入使用者
  created_at timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, player_id)
);
create index th_players_room on public.th_players (room_id);
create index th_players_user on public.th_players (user_id);

create trigger trg_th_rooms_updated_at before update on public.th_rooms
  for each row execute function games_touch_room();

-- ② 權限：只有伺服器（service_role，會略過 RLS）能讀寫
alter table public.th_rooms enable row level security;
alter table public.th_players enable row level security;
revoke all on table public.th_rooms, public.th_players from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.th_rooms, public.th_players from anon, authenticated;
    grant select, insert, update, delete on table public.th_rooms, public.th_players to service_role;
  end if;
end $$;

-- ③ 對局紀錄可以記十三支
alter table public.match_records drop constraint match_records_game_check;
alter table public.match_records add constraint match_records_game_check check (game in ('mahjong', 'big2', 'thirteen'));

-- ④ 關房：多一個 thirteen 分支（其他照抄 20261017_mahjong_login.sql）
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
  elsif p_game = 'thirteen' then
    select row_version, nullif(game_state->>'stateVersion', '')::int
      into v_row_version, v_version
      from th_rooms where id = p_room_id
      for update;
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
  elsif p_game = 'thirteen' then
    delete from th_rooms where id = p_room_id;     -- th_players 會 cascade 刪掉
  else
    delete from big2_rooms where id = p_room_id;   -- big2_players 會 cascade 刪掉
  end if;
  return 'closed';
end $$;

commit;

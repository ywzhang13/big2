-- 對局總結算紀錄＋自動清房（2026-10-16）
-- 只新增表、欄位、trigger、function，不改也不刪現有資料。
-- 順序：先跑這份，再部署程式（程式在這份還沒跑時也不會壞：寫紀錄失敗就不刪房、建房會自動退回舊寫法）。
-- 回滾：20261016_match_records_rollback.sql
begin;

-- 1. 場次（一筆＝一間房從開局到結束；只記總結算，不記每局明細和手牌）
create table if not exists match_records (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('mahjong', 'big2')),
  room_id uuid not null,                      -- 原房間 id（房間會被刪，不設外鍵）
  room_code char(4) not null,                 -- 原房號（之後會被重用，不設唯一）
  started_at timestamptz,                     -- 開局時間（麻將：開局那一刻；大老二：建房時間）
  ended_at timestamptz not null default now(),
  end_reason text not null check (end_reason in ('completed', 'dissolved')), -- 正常打完／中途解散
  total_rounds int,                           -- 麻將：圈數
  base_points int,                            -- 麻將：底
  fan_points int,                             -- 麻將：每台
  settings jsonb not null default '{}',       -- 各遊戲自己的設定（大老二目前沒有）
  hands_played int,                           -- 麻將：打完幾局（大老二無法精確算，空值）
  created_at timestamptz not null default now(),
  unique (game, room_id)                      -- 同一間房只會有一筆：重送不會重複
);
create index if not exists idx_match_records_code_ended on match_records (game, room_code, ended_at desc);

-- 2. 場次玩家（四位玩家的總輸贏）
create table if not exists match_record_players (
  match_id uuid not null references match_records(id) on delete cascade,
  seat int not null check (seat between 0 and 3),
  player_name text not null,
  player_id text not null,                    -- 原本的匿名玩家 id（瀏覽器產生）
  total_score int not null,                   -- 整場總輸贏
  user_id uuid,                               -- 預留給 LINE 登入，現在一律空的
  primary key (match_id, seat)
);
create index if not exists idx_match_record_players_player on match_record_players (player_id);
create index if not exists idx_match_record_players_user on match_record_players (user_id);

-- 3. 權限：只有伺服器（service role，會略過 RLS）能讀寫；公開金鑰不能讀、不能寫、不能改
alter table match_records enable row level security;
alter table match_record_players enable row level security;
-- （刻意不建立任何 policy）

-- 4. 房間「最後活動時間」和「異動次數」：由 trigger 在每次更新時自動填，現有程式不用改
--    updated_at 用來算閒置多久；row_version 每次更新 +1，用來確認「選中之後有沒有人動過」（不受時鐘精度影響）
--    ⚠️ 這個資料庫和其他服務共用（已有別的表在用 public.set_updated_at()），所以用遊戲專用的名字，
--       不能覆蓋共用的 set_updated_at（2026-10-15 曾因此讓 commercialbot 的表更新失敗，已修正）
create or replace function games_touch_room() returns trigger
language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  new.row_version = old.row_version + 1;
  return new;
end $$;

alter table mj_rooms add column if not exists updated_at timestamptz not null default now();
alter table big2_rooms add column if not exists updated_at timestamptz not null default now();
alter table mj_rooms add column if not exists row_version bigint not null default 0;
alter table big2_rooms add column if not exists row_version bigint not null default 0;
create index if not exists idx_mj_rooms_status_updated on mj_rooms (status, updated_at);
create index if not exists idx_big2_rooms_status_updated on big2_rooms (status, updated_at);

drop trigger if exists trg_mj_rooms_updated_at on mj_rooms;
create trigger trg_mj_rooms_updated_at before update on mj_rooms
  for each row execute function games_touch_room();
drop trigger if exists trg_big2_rooms_updated_at on big2_rooms;
create trigger trg_big2_rooms_updated_at before update on big2_rooms
  for each row execute function games_touch_room();

-- 5. 大老二「這間房要不要記紀錄」：新版程式建房時寫 true；上線前（舊程式）建的房都是 false → 不補記
--    （麻將靠牌局狀態裡的 handsCompleted 判斷，不需要欄位）
alter table big2_rooms add column if not exists records_enabled boolean not null default false;

-- 6. 一次完成「寫紀錄＋刪房」：同一個交易裡，要嘛全部成功、要嘛全部不做
--    p_record 為 null：不記紀錄，只刪房（一局都沒打完、或上線前的房）
--    p_expected_row_version：清理選中時看到的 row_version；p_expected_version：麻將牌局狀態的版本號
--    刪除當下不一樣（房間有新動作）就不做
--    回傳：closed 已記錄並刪房／already_closed 早就關了（重送）／changed 有新動作沒動／not_found 沒這間房
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

-- 只有伺服器能呼叫（預設 public 可以執行 function，要收回）
revoke all on function close_room_with_record(text, uuid, jsonb, bigint, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function close_room_with_record(text, uuid, jsonb, bigint, int) from anon, authenticated;
    grant execute on function close_room_with_record(text, uuid, jsonb, bigint, int) to service_role;
  end if;
end $$;

commit;

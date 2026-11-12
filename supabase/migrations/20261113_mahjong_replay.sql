-- 麻將牌局回放（老闆 2026-11-13：保留 7 天、只有上桌 4 人能看、可切換四家視角）
-- 只新增、不改舊資料：新表 mj_hand_replays、新函式 mj_replay_save／mj_replay_purge／mj_replay_match／mj_replay_hands／mj_replay_hand。
--   一局一列：summary＝列表用的摘要，data＝整局紀錄（發完牌的樣子＋每一步哪幾張牌移到哪裡，格式見 lib/mahjong/replay/log.ts），一局約 3～6 KB
--   保留：整場結束後 7 天。過期由 mj_replay_save 每次寫新的一局時順手刪（不另外排程、不多請求）；
--         讀取 API 不看資料還在不在，一律用「整場結束時間＋7 天」判斷過期回 410，所以清除稍晚也不會被讀到。
--   房間沒有對戰紀錄（從沒結束、資料異常）的回放，寫入超過 14 天也刪。
-- 權限：公開金鑰（anon、authenticated）完全不能讀寫，只有伺服器（service role）能用；誰能看由 API 用 match_record_players 的帳號判斷。
-- 回滾見 20261113_mahjong_replay_rollback.sql（只刪本檔新增的東西，回放資料會一起刪掉，其他表不動）。
begin;

do $$
begin
  if to_regclass('public.match_records') is null or to_regclass('public.match_record_players') is null then
    raise exception '拒絕套用：請先套用 20261016_match_records.sql';
  end if;
  if to_regclass('public.mj_hand_replays') is not null then
    raise exception '拒絕套用：mj_hand_replays 已經存在（已經套用過？）';
  end if;
end $$;

create table public.mj_hand_replays (
  room_id uuid not null,                       -- 哪一場（= match_records.room_id；房間關掉後照樣留著）
  hand_no int not null check (hand_no >= 1),   -- 第幾局（牌局狀態的 handsCompleted）
  summary jsonb not null,                      -- 列表用摘要
  data jsonb not null,                         -- 整局紀錄
  recorded_at timestamptz not null default now(),
  primary key (room_id, hand_no)
);
comment on table public.mj_hand_replays is 'mj_hand_replays:20261113';
create index mj_hand_replays_recorded_at on public.mj_hand_replays (recorded_at);
alter table public.mj_hand_replays enable row level security;
revoke all on table public.mj_hand_replays from public, anon, authenticated, service_role;
grant select, insert, delete on table public.mj_hand_replays to service_role;

-- 刪掉過期的回放：整場結束超過 7 天的；以及沒有對戰紀錄、寫入超過 14 天的。回傳刪了幾局
create function public.mj_replay_purge(p_now timestamptz default now())
returns int
language sql
set search_path = public
as $$
  with gone as (
    delete from mj_hand_replays r
    where exists (select 1 from match_records m where m.game = 'mahjong' and m.room_id = r.room_id and m.ended_at <= p_now - interval '7 days')
       or (r.recorded_at <= p_now - interval '14 days'
           and not exists (select 1 from match_records m where m.game = 'mahjong' and m.room_id = r.room_id))
    returning 1
  )
  select count(*)::int from gone
$$;

-- 一局結算時寫入（同一局重送不會重複、不會覆蓋），順便清掉過期的。回傳這次新寫了幾列（0 或 1）
create function public.mj_replay_save(p_room uuid, p_hand int, p_summary jsonb, p_data jsonb, p_now timestamptz default now())
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  insert into mj_hand_replays (room_id, hand_no, summary, data, recorded_at)
  values (p_room, p_hand, p_summary, p_data, p_now)
  on conflict (room_id, hand_no) do nothing;
  get diagnostics n = row_count;
  perform mj_replay_purge(p_now);
  return n;
end
$$;

-- 讀取前的檢查：這一場（match_records.id）的房間、結束時間、到期時間、這位帳號坐哪個座位（沒上桌＝null）、是否已過期、四家名字。
-- 找不到這一場（還沒結束、不是麻將、id 不存在）回 0 列
create function public.mj_replay_match(p_match uuid, p_user uuid, p_now timestamptz default now())
returns table (room_id uuid, room_code text, ended_at timestamptz, expires_at timestamptz, my_seat int, expired boolean, players jsonb)
language sql
stable
set search_path = public
as $$
  select m.room_id, m.room_code::text, m.ended_at, m.ended_at + interval '7 days',
    (select p.seat from match_record_players p where p.match_id = m.id and p.user_id = p_user order by p.seat limit 1),
    m.ended_at + interval '7 days' <= p_now,
    coalesce((select jsonb_agg(jsonb_build_object('seat', p.seat, 'name', p.player_name) order by p.seat) from match_record_players p where p.match_id = m.id), '[]'::jsonb)
  from match_records m
  where m.id = p_match and m.game = 'mahjong'
$$;

-- 這一場有哪些局可以回放（只回摘要）
create function public.mj_replay_hands(p_room uuid)
returns table (hand_no int, summary jsonb, recorded_at timestamptz)
language sql
stable
set search_path = public
as $$
  select r.hand_no, r.summary, r.recorded_at from mj_hand_replays r where r.room_id = p_room order by r.hand_no
$$;

-- 某一局的整份紀錄；沒有回 null
create function public.mj_replay_hand(p_room uuid, p_hand int)
returns jsonb
language sql
stable
set search_path = public
as $$
  select r.data from mj_hand_replays r where r.room_id = p_room and r.hand_no = p_hand
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.mj_replay_purge(timestamptz)', 'public.mj_replay_save(uuid, int, jsonb, jsonb, timestamptz)',
                           'public.mj_replay_match(uuid, uuid, timestamptz)', 'public.mj_replay_hands(uuid)', 'public.mj_replay_hand(uuid, int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'public.mj_hand_replays', f) or has_table_privilege('authenticated', 'public.mj_hand_replays', f) then
      raise exception '回放表鎖權限沒有完成：公開金鑰還有 %，整份不生效', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.mj_replay_hand(uuid, int)', 'execute') or has_function_privilege('authenticated', 'public.mj_replay_hand(uuid, int)', 'execute') then
    raise exception '回放函式鎖權限沒有完成，整份不生效';
  end if;
end $$;

commit;

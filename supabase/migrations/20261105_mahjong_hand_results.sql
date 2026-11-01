-- 斗內與對戰紀錄的三個增量修改（老闆 2026-11-02）
--   ① 老闆帳號不算斗內：他的自摸不產生應給、不出現在後台未結清、斗內卡不顯示（自摸紀錄保留不刪）
--   ② 從上線後開始，每一把都記胡牌者和放槍者（用座位記，遊客也記得到）；流局也記一列（winner_seat = -1）。舊資料不回填
--   ③ 對戰紀錄每場每位玩家的胡牌、自摸、放槍數：這場每一把都有紀錄才算得出來，否則回 null（上線前的場次、上線時正在打的場次）
-- 只新增、不改舊資料：新表 mj_hand_results、新函式 mj_match_hand_stats；改寫 mj_donate_count、mj_match_unsettled（多排除老闆帳號）。
-- 回滾見 20261105_mahjong_hand_results_rollback.sql。
begin;

do $$
begin
  if to_regprocedure('public.mj_match_unsettled(uuid)') is null then
    raise exception '拒絕套用：請先套用 20261104_mahjong_match_settle.sql';
  end if;
  if to_regclass('public.mj_hand_results') is not null then
    raise exception '拒絕套用：mj_hand_results 已經存在（已經套用過？）';
  end if;
end $$;

-- ② 每一把的結果。一把一列（一炮多響有幾個胡的就幾列）；流局 winner_seat = -1、from_seat null
create table public.mj_hand_results (
  room_id uuid not null,               -- 哪一場（= match_records.room_id；房間關掉後照樣留著）
  hand_no int not null check (hand_no >= 1),  -- 第幾把（牌局狀態的 handsCompleted）
  winner_seat int not null check (winner_seat between -1 and 3),  -- 胡牌的座位；-1＝流局
  from_seat int check (from_seat between 0 and 3),  -- 放槍的座位；自摸、流局是 null
  self_draw boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (room_id, hand_no, winner_seat),
  check ((winner_seat = -1 and from_seat is null and not self_draw) or (winner_seat >= 0 and (self_draw = (from_seat is null))))
);
comment on table public.mj_hand_results is 'mj_hand_results:20261105';
alter table public.mj_hand_results enable row level security;
revoke all on table public.mj_hand_results from public, anon, authenticated, service_role;
grant select, insert on table public.mj_hand_results to service_role;

-- ① 老闆帳號（lib/mahjong/zimoFx/rules.ts 的 OWNER_USER_ID）不算斗內
create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from mj_zimo_wins w
  where w.user_id = p_user_id and w.won_at > '2026-11-01T00:00:00+08:00'::timestamptz
    and w.user_id <> 'c5707922-f6f0-4c10-9c87-3532fdbf6b72'::uuid
    and not exists (select 1 from mj_match_settlements s where s.room_id = w.room_id and s.user_id = w.user_id and s.revoked_at is null)
$$;

create or replace function public.mj_match_unsettled(p_user uuid default null)
returns table (user_id uuid, room_id uuid, room_code text, started_at timestamptz, ended_at timestamptz, zimo int, due int)
language sql
stable
set search_path = public
as $$
  select w.user_id, w.room_id, m.room_code::text, m.started_at, m.ended_at, count(*)::int, count(*)::int * 10
  from mj_zimo_wins w
  left join match_records m on m.game = 'mahjong' and m.room_id = w.room_id
  where w.won_at > '2026-11-01T00:00:00+08:00'::timestamptz and (p_user is null or w.user_id = p_user)
    and w.user_id <> 'c5707922-f6f0-4c10-9c87-3532fdbf6b72'::uuid
    and not exists (select 1 from mj_match_settlements s where s.room_id = w.room_id and s.user_id = w.user_id and s.revoked_at is null)
  group by w.user_id, w.room_id, m.room_code, m.started_at, m.ended_at
$$;

-- ③ 每場每個座位的胡牌（含自摸）、自摸、放槍數，以及這場記了幾把（路由拿去和 hands_played 比，不齊就回 null）
create function public.mj_match_hand_stats(p_rooms uuid[])
returns table (room_id uuid, hands int, seat int, wins int, self_draws int, deal_ins int)
language sql
stable
set search_path = public
as $$
  with h as (select r.room_id, count(distinct r.hand_no)::int hands from mj_hand_results r where r.room_id = any (p_rooms) group by r.room_id)
  select h.room_id, h.hands, s.seat,
    (select count(*)::int from mj_hand_results r where r.room_id = h.room_id and r.winner_seat = s.seat),
    (select count(*)::int from mj_hand_results r where r.room_id = h.room_id and r.winner_seat = s.seat and r.self_draw),
    (select count(distinct r.hand_no)::int from mj_hand_results r where r.room_id = h.room_id and r.from_seat = s.seat)  -- 一炮多響：同一把放槍只算一次（審伯 2026-11-02）
  from h cross join generate_series(0, 3) as s(seat)
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.mj_donate_count(uuid)', 'public.mj_match_unsettled(uuid)', 'public.mj_match_hand_stats(uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'public.mj_hand_results', f) or has_table_privilege('authenticated', 'public.mj_hand_results', f) then
      raise exception '每把結果表鎖權限沒有完成：公開金鑰還有 %，整份不生效', f;
    end if;
  end loop;
end $$;

commit;

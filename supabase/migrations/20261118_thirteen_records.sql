-- 十三支「我的對局紀錄」查詢（老柯 2026-11-18）：只新增一個唯讀函式 th_my_matches，不改任何資料表、不改既有函式。
-- 麻將的歷史紀錄、排行榜不受影響（它們本來就只查 game = 'mahjong'）。
--   th_my_matches(使用者, 筆數, 游標時間, 游標 id) → jsonb { items: [...], summary: { matches, totalScore } }
--   ・items：這個帳號有座位的十三支場次，ended_at、id 由新到舊；游標＝上一頁最後一筆（keyset 分頁），一次最多 51 筆
--   ・每場只回房號、結束時間、結束原因、打了幾局、理牌秒數、局數設定和四家分數（不回帳號 id、不回最後一局的牌 finalHand）
--   ・summary：這個帳號全部十三支場次的場數和累計分數
-- 權限：只有 service_role（伺服器路由，用登入身分帶入使用者）能執行；PUBLIC、anon、authenticated 收回。
-- 回滾：20261118_thirteen_records_rollback.sql（drop 這個函式）。
begin;

do $$
begin
  if to_regclass('public.match_records') is null or to_regclass('public.match_record_players') is null then
    raise exception '拒絕套用：找不到 match_records／match_record_players';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'th_my_matches'
             and obj_description(oid, 'pg_proc') is distinct from 'th_my_matches:20261118') then
    raise exception '拒絕套用：th_my_matches 已經存在，而且不是這份 migration 建的';
  end if;
end $$;

create or replace function public.th_my_matches(
  p_user_id uuid,
  p_limit int,
  p_cursor_ended_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (
    select m.id, m.room_code, m.ended_at, m.end_reason, m.hands_played, m.settings, me.total_score
      from match_records m
      join match_record_players me on me.match_id = m.id and me.user_id = p_user_id
     where m.game = 'thirteen'
  ), page as (
    select * from mine
     where p_cursor_ended_at is null or (ended_at, id) < (p_cursor_ended_at, p_cursor_id)
     order by ended_at desc, id desc
     limit least(greatest(p_limit, 1), 51)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pg.id, 'roomCode', pg.room_code, 'endedAt', pg.ended_at, 'endReason', pg.end_reason,
               'handsPlayed', pg.hands_played, 'arrangeSec', (pg.settings->>'arrangeSec')::int,
               'totalHands', (pg.settings->>'totalHands')::int, 'myScore', pg.total_score,
               'players', (select jsonb_agg(jsonb_build_object('seat', p.seat, 'playerName', p.player_name,
                                    'totalScore', p.total_score, 'isMe', p.user_id is not distinct from p_user_id) order by p.seat)
                             from match_record_players p where p.match_id = pg.id))
             order by pg.ended_at desc, pg.id desc)
        from page pg), '[]'::jsonb),
    'summary', (select jsonb_build_object('matches', count(*), 'totalScore', coalesce(sum(total_score), 0)) from mine)
  )
$$;

comment on function public.th_my_matches(uuid, int, timestamptz, uuid) is 'th_my_matches:20261118';
revoke all on function public.th_my_matches(uuid, int, timestamptz, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.th_my_matches(uuid, int, timestamptz, uuid) from anon, authenticated;
    grant execute on function public.th_my_matches(uuid, int, timestamptz, uuid) to service_role;
  end if;
end $$;

commit;

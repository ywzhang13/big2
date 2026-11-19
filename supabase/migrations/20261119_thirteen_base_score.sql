-- 十三支底分（老柯 2026-11-19，老闆：開房選 50／100／200／500，每局分數＝淨墩數 × 底分）：「我的十三支紀錄」多回 baseScore。
-- 只換 th_my_matches 一個函式（create or replace，參數、回傳型別、權限都不變）：每場多一個 baseScore 欄位，
-- 讀 match_records.settings->>'baseScore'；上線前打完的場次沒有這個欄位，回 1（分數本來就沒乘）。不改任何資料表、不動麻將。
-- 底分本身存在 th_rooms.game_state.settings 和 match_records.settings（jsonb），不用新增欄位。
-- 回滾：20261119_thirteen_base_score_rollback.sql（換回 20261118 原文，只是少回 baseScore）。
begin;

do $$
begin
  if to_regprocedure('public.th_my_matches(uuid, int, timestamptz, uuid)') is null then
    raise exception '拒絕套用：找不到 th_my_matches，請先套用 20261118_thirteen_records.sql';
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
               'totalHands', (pg.settings->>'totalHands')::int,
               'baseScore', coalesce((pg.settings->>'baseScore')::int, 1), 'myScore', pg.total_score,
               'players', (select jsonb_agg(jsonb_build_object('seat', p.seat, 'playerName', p.player_name,
                                    'totalScore', p.total_score, 'isMe', p.user_id is not distinct from p_user_id) order by p.seat)
                             from match_record_players p where p.match_id = pg.id))
             order by pg.ended_at desc, pg.id desc)
        from page pg), '[]'::jsonb),
    'summary', (select jsonb_build_object('matches', count(*), 'totalScore', coalesce(sum(total_score), 0)) from mine)
  )
$$;

comment on function public.th_my_matches(uuid, int, timestamptz, uuid) is 'th_my_matches:20261119';

commit;

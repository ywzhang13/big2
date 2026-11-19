-- 回滾 20261119_thirteen_base_score.sql：th_my_matches 換回 20261118_thirteen_records.sql 的原文（少回 baseScore，其他一樣）。
-- 不動任何資料：已經存進 match_records.settings 的 baseScore 留著，舊版程式不讀它。先把程式退回不讀 baseScore 的版本再跑。
begin;

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

commit;

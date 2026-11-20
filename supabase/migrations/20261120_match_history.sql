-- 三款共用的「我的歷史紀錄」查詢（老柯 2026-11-20；規劃 v1 第 3 節、小宜房卡設計說明 v1.2 第 3 節）。
-- 只新增一個唯讀函式 my_matches，不改任何資料表、不改既有函式（麻將 /api/mahjong/records、十三支 th_my_matches 照舊）。
--   my_matches(使用者, 遊戲, 筆數, 游標時間, 游標 id) → jsonb { items, counts, summary }
--   ・遊戲：null 或 'all'＝全部；'mahjong'／'thirteen'／'big2' 只看那一款
--   ・只回「這個使用者有入座」的場次（match_record_players.user_id = 使用者）；別人的場次一筆都看不到
--   ・items：結束時間由新到舊（keyset 分頁，同十三支），每場：id、遊戲、房號、結束時間、結束原因、
--     設定的局數（麻將 total_rounds 圈、十三支 settings.totalHands 局）、實際打了幾把／幾局、自己的分數、四家名字和分數（isMe 標自己，不含帳號 id）
--   ・counts：四個頁籤各有幾場（全部＝三款加總）；summary：這個頁籤的場數、總輸贏（全部頁籤不加總分數：各遊戲算法不同，回 null）
--   ・不回房卡（老闆決定：紀錄不顯示每局扣幾張）
--   ・大老二的紀錄沒有記帳號（user_id 一律空的），所以大老二頁籤一定是 0 場
-- 權限：只有 service_role 能執行。回滾：20261120_match_history_rollback.sql（刪掉這個函式）。
begin;

do $$
begin
  if to_regclass('public.match_records') is null or to_regclass('public.match_record_players') is null then
    raise exception '拒絕套用：找不到 match_records／match_record_players';
  end if;
  if to_regprocedure('public.my_matches(uuid, text, int, timestamptz, uuid)') is not null then
    raise exception '拒絕套用：my_matches 已經存在（這份已經套用過）';
  end if;
end $$;

create function public.my_matches(
  p_user_id uuid,
  p_game text default null,
  p_limit int default 20,
  p_cursor_ended_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  with mine_all as (
    select m.id, m.game, m.room_code, m.ended_at, m.end_reason, m.total_rounds, m.hands_played, m.settings, me.total_score
      from match_records m
      join match_record_players me on me.match_id = m.id and me.user_id = p_user_id
  ), mine as (
    select * from mine_all where coalesce(p_game, 'all') = 'all' or game = p_game
  ), page as (
    select * from mine
     where p_cursor_ended_at is null or (ended_at, id) < (p_cursor_ended_at, p_cursor_id)
     order by ended_at desc, id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pg.id, 'game', pg.game, 'roomCode', pg.room_code, 'endedAt', pg.ended_at, 'endReason', pg.end_reason,
               'totalRounds', pg.total_rounds, 'totalHands', (pg.settings->>'totalHands')::int, 'handsPlayed', pg.hands_played,
               'myScore', pg.total_score,
               'players', (select jsonb_agg(jsonb_build_object('seat', p.seat, 'playerName', p.player_name,
                                    'totalScore', p.total_score, 'isMe', p.user_id is not distinct from p_user_id) order by p.seat)
                             from match_record_players p where p.match_id = pg.id))
             order by pg.ended_at desc, pg.id desc)
        from page pg), '[]'::jsonb),
    'counts', (select jsonb_build_object('all', count(*), 'mahjong', count(*) filter (where game = 'mahjong'),
                 'thirteen', count(*) filter (where game = 'thirteen'), 'big2', count(*) filter (where game = 'big2')) from mine_all),
    'summary', (select jsonb_build_object('matches', count(*),
                 'totalScore', case when coalesce(p_game, 'all') = 'all' then null else coalesce(sum(total_score), 0) end) from mine)
  )
$$;

revoke all on function public.my_matches(uuid, text, int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.my_matches(uuid, text, int, timestamptz, uuid) to service_role;
comment on function public.my_matches(uuid, text, int, timestamptz, uuid) is 'my_matches:20261120';

commit;

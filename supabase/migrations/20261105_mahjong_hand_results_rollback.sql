-- 回滾 20261105_mahjong_hand_results.sql：mj_donate_count、mj_match_unsettled 改回 20261104 的本體（老闆帳號又算回斗內），拿掉 mj_match_hand_stats。
--   ・mj_hand_results 整張保留（已經記下的每把結果；新程式之後照樣能用）。資料一筆都不刪
--   ・回滾後程式若還是新版，對戰紀錄的胡牌／放槍數仍會用到 mj_match_hand_stats → 查不到時路由回 null（不會壞），所以程式要一起退回
begin;

drop function if exists public.mj_match_hand_stats(uuid[]);

create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from mj_zimo_wins w
  where w.user_id = p_user_id and w.won_at > '2026-11-01T00:00:00+08:00'::timestamptz
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
    and not exists (select 1 from mj_match_settlements s where s.room_id = w.room_id and s.user_id = w.user_id and s.revoked_at is null)
  group by w.user_id, w.room_id, m.room_code, m.started_at, m.ended_at
$$;

commit;

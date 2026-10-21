-- 回滾 20261021_mahjong_donate.sql：刪掉自摸紀錄、斗內歸零點兩張表和三個函式。不動其他資料表。
-- ⚠️ 自摸次數和歸零點會一起刪掉（之後重新套用，大家從 0 開始）；要保留就先匯出：copy (select * from mj_zimo_wins) to stdout。
-- 只刪有標記註解 'mj_donate:20261021' 的物件（這份 migration 建的）。
-- 如果同名的表或函式不是這份建的（沒有標記），就整份拒絕、什麼都不刪；物件不存在則什麼都不做（可以重跑）。
begin;

do $$
declare
  v_marker constant text := 'mj_donate:20261021';
  t text;
  f text;
begin
  foreach t in array array['mj_zimo_wins', 'mj_donate_acks'] loop
    if to_regclass('public.' || t) is not null and obj_description(to_regclass('public.' || t), 'pg_class') is distinct from v_marker then
      raise exception '拒絕回滾：public.% 不是 20261021_mahjong_donate.sql 建的，不刪', t;
    end if;
  end loop;
  foreach f in array array['mj_zimo_record', 'mj_donate_count', 'mj_donate_ack'] loop
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f
               and obj_description(oid, 'pg_proc') is distinct from v_marker) then
      raise exception '拒絕回滾：public.% 不是 20261021_mahjong_donate.sql 建的，不刪', f;
    end if;
  end loop;

  -- mj_donate_ack 會呼叫 mj_donate_count，先刪它
  if to_regprocedure('public.mj_donate_ack(uuid, timestamptz)') is not null then
    drop function public.mj_donate_ack(uuid, timestamptz);
  end if;
  if to_regprocedure('public.mj_donate_count(uuid)') is not null then
    drop function public.mj_donate_count(uuid);
  end if;
  if to_regprocedure('public.mj_zimo_record(uuid, int, uuid[], timestamptz)') is not null then
    drop function public.mj_zimo_record(uuid, int, uuid[], timestamptz);
  end if;
  if to_regclass('public.mj_zimo_wins') is not null then
    drop table public.mj_zimo_wins; -- 索引 mj_zimo_wins_user 跟著表一起刪
  end if;
  if to_regclass('public.mj_donate_acks') is not null then
    drop table public.mj_donate_acks;
  end if;
end $$;

commit;

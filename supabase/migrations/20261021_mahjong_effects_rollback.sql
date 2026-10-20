-- 回滾 20261021_mahjong_effects.sql：刪掉特效冷卻的表和函式（只存最後送出時間，刪掉不影響牌局）。不動其他資料表。
-- 只刪有標記註解 'mj_effects:20261021' 的物件（這份 migration 建的）。
-- 如果同名的表或函式不是這份建的（沒有標記），就整份拒絕、什麼都不刪；物件不存在則什麼都不做（可以重跑）。
begin;

do $$
declare
  v_marker constant text := 'mj_effects:20261021';
  v_tbl oid := to_regclass('public.mj_effect_rate');
  v_fn oid := to_regprocedure('public.mj_effect_take(text, text, text, text, int, int, timestamptz)');
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕回滾：public.mj_effect_rate 不是 20261021_mahjong_effects.sql 建的，不刪';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mj_effect_take'
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕回滾：public.mj_effect_take 不是 20261021_mahjong_effects.sql 建的，不刪';
  end if;
  if v_fn is not null then
    drop function public.mj_effect_take(text, text, text, text, int, int, timestamptz);
  end if;
  if v_tbl is not null then
    drop table public.mj_effect_rate; -- 索引 mj_effect_rate_last_at 跟著表一起刪
  end if;
end $$;

commit;

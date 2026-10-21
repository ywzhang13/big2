-- 回滾 20261022_mahjong_prefs.sql：刪掉偏好設定表。不動其他資料表。
-- ⚠️ 已存的偏好設定會一起刪掉（各裝置的本機設定不受影響）；要保留就先匯出：copy (select * from mj_user_prefs) to stdout。
-- 只刪有標記註解 'mj_prefs:20261022' 的表（這份 migration 建的）。
-- 如果同名的表不是這份建的（沒有標記），就整份拒絕、什麼都不刪；表不存在則什麼都不做（可以重跑）。
begin;

do $$
begin
  if to_regclass('public.mj_user_prefs') is null then
    return;
  end if;
  if obj_description(to_regclass('public.mj_user_prefs'), 'pg_class') is distinct from 'mj_prefs:20261022' then
    raise exception '拒絕回滾：public.mj_user_prefs 不是 20261022_mahjong_prefs.sql 建的，不刪';
  end if;
  drop table public.mj_user_prefs; -- 主鍵索引、外鍵跟著表一起刪
end $$;

commit;

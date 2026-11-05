-- 如來神掌（rulai，老闆專屬，老闆 2026-11-05）：mj_fx_prefs 可以存 rulai。
--   只放寬選用表的檢查限制，不動資料、不改函式：
--   ・mj_fx_select 只檢查開通，不看代號，不用改。「只有老闆能選」擋在選用 API 和 resolveZimoFx（lib/mahjong/zimoFx/rules.ts）
--   ・mj_fx_grants 的檢查限制不動：rulai 不能開通
--   ⚠️ 順序：先套這份、再推程式。沒套之前，新程式替老闆選 rulai 會違反檢查限制（500）；舊程式遇到這份完全不受影響。
--   回滾見 20261107_mahjong_fx_rulai_rollback.sql。
begin;

do $$
begin
  if to_regclass('public.mj_fx_prefs') is null then
    raise exception '拒絕套用：請先套用 20261031_mahjong_zimo_fx.sql';
  end if;
end $$;

alter table public.mj_fx_prefs drop constraint if exists mj_fx_prefs_fx_check;
alter table public.mj_fx_prefs add constraint mj_fx_prefs_fx_check
  check (fx in ('golden', 'meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura', 'rulai'));

commit;

-- 回滾 20261110_mahjong_fx_nuke.sql：選了 nuke 的列改回金色（每人寫一筆操作紀錄，detail 標 rollback），再收回檢查限制。
--   ⚠️ 順序：先跑這份、再退程式。新程式在這份跑完後，替那個帳號選 nuke 會 500，其他選用（含 rulai）不受影響。
begin;

with changed as (
  update public.mj_fx_prefs set fx = 'golden', updated_at = now() where fx = 'nuke' returning user_id
)
insert into public.mj_fx_audit (at, actor_id, action, target_user_id, detail)
select now(), 'system', 'fx_select', user_id, jsonb_build_object('fx', 'golden', 'from', 'nuke', 'rollback', true) from changed;

alter table public.mj_fx_prefs drop constraint if exists mj_fx_prefs_fx_check;
alter table public.mj_fx_prefs add constraint mj_fx_prefs_fx_check
  check (fx in ('golden', 'meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura', 'rulai'));

commit;

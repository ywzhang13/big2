-- 回滾 20261031_mahjong_zimo_fx.sql：刪掉自摸特效庫和斗內後台的表、函式、觸發器。不動其他資料表。
-- ⚠️ 會連同斗內紀錄、開通紀錄、操作紀錄一起刪掉：已經在正式站記過帳的話，先匯出（或改成只關掉程式、不跑這份）。
-- 只刪有標記註解 'mj_zimo_fx:20261031' 的物件；同名物件不是這份建的就整份拒絕；物件不存在則什麼都不做（可以重跑）。
-- 老闆帳號的隕石不靠這些表（程式裡寫死永久全開），回滾後照樣有隕石。
-- 不動 20261021 的 mj_donate_acks（斗內卡歸零點）：老闆記帳時歸零過的時間照樣保留。
begin;

do $$
declare
  v_marker constant text := 'mj_zimo_fx:20261031';
  t text;
begin
  foreach t in array array['mj_donations', 'mj_fx_grants', 'mj_fx_prefs', 'mj_fx_audit'] loop
    if to_regclass('public.' || t) is not null and obj_description(to_regclass('public.' || t), 'pg_class') is distinct from v_marker then
      raise exception '拒絕回滾：public.% 不是 20261031_mahjong_zimo_fx.sql 建的，不刪', t;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('mj_donation_add', 'mj_donation_void', 'mj_fx_grant', 'mj_fx_revoke', 'mj_fx_select', 'mj_zimo_fx_for', 'mj_zimo_fx_guard')
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕回滾：mj_donation_*／mj_fx_*／mj_zimo_fx_* 函式不是 20261031_mahjong_zimo_fx.sql 建的，不刪';
  end if;
  -- 先刪表（觸發器跟著刪），再刪函式
  drop table if exists public.mj_donations, public.mj_fx_grants, public.mj_fx_prefs, public.mj_fx_audit;
  drop function if exists public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz);
  drop function if exists public.mj_donation_void(text, uuid, text, timestamptz);
  drop function if exists public.mj_fx_grant(text, text, text[], text, timestamptz, timestamptz);
  drop function if exists public.mj_fx_revoke(text, text, text[], timestamptz);
  drop function if exists public.mj_fx_select(text, text, boolean, timestamptz);
  drop function if exists public.mj_zimo_fx_for(text[], timestamptz);
  drop function if exists public.mj_zimo_fx_guard();
end $$;

commit;

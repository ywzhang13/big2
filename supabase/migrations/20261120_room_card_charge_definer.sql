-- 修正：正式站房卡一張都沒扣（老柯 2026-11-20 13:40 查明）。要先套 20261120_room_cards.sql。
-- 原因：room_card_charge 要讀 auth.users 排除遊客，但伺服器用的 service_role 在正式站讀不到 auth.users
--   （has_table_privilege('service_role','auth.users','select') = false），所以每一次扣卡都
--   「permission denied for table users」→ 程式只寫 log、不擋牌局（照設計），結果 11:05 上線後一張都沒扣。
--   同一個問題 mj_zimo_record 早就用 SECURITY DEFINER 處理（20261021_mahjong_donate.sql 第 90 行），房卡漏了。
-- 修法：只把 room_card_charge 改成 SECURITY DEFINER（以套用者 postgres 的身分執行，讀得到 auth.users），search_path 照舊固定。
--   不改函式內容、不改參數、不改任何資料；執行權限照舊只有 service_role（anon、authenticated 本來就收回了）。
--   其他房卡函式只讀寫 public 的表，service_role 本來就有權限，不用改。
-- 回滾：20261120_room_card_charge_definer_rollback.sql（改回 SECURITY INVOKER；回到扣不到卡的狀態）。
begin;

do $$
begin
  if to_regprocedure('public.room_card_charge(text, text, text, integer, uuid[], timestamptz)') is null then
    raise exception '拒絕套用：找不到 room_card_charge，請先套用 20261120_room_cards.sql';
  end if;
end $$;

alter function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) security definer;
alter function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) set search_path = public, pg_temp;
revoke all on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) to service_role;
comment on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) is 'room_cards:20261120 charge_definer';

commit;

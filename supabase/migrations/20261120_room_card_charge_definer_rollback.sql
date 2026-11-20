-- 回滾 20261120_room_card_charge_definer.sql：room_card_charge 改回 SECURITY INVOKER（search_path 改回 public）。
-- ⚠️ 改回去之後，正式站 service_role 又讀不到 auth.users，扣卡會再全部失敗（只寫 log）。只在這份修正本身出問題時用。
begin;
alter function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) security invoker;
alter function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) set search_path = public;
comment on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) is 'room_cards:20261120';
commit;

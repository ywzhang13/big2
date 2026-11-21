-- 回滾 20261120_big2_start_confirm.sql：刪掉 big2_rooms 的 start_confirm、last_start_confirm 和 big2_seat_keys 表。
-- ⚠️ 要先把程式退回不讀這兩欄的版本，不然大老二開不了局。進行中的確認會消失（房間留在 ready_check 的，舊程式照舊處理）。
begin;
drop table if exists public.big2_seat_keys;
alter table public.big2_rooms drop column if exists last_start_confirm;
alter table public.big2_rooms drop column if exists start_confirm;
commit;

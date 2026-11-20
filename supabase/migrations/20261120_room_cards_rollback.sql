-- 回滾 20261120_room_cards.sql：刪掉房卡的四張表（含操作編號 room_card_ops）、觸發器和七個函式。
-- ⚠️ 已記的房卡帳（餘額、流水帳、暫停紀錄）會一起刪掉；跑之前先匯出備份：
--   copy (select * from room_card_accounts) to stdout with csv header; 另外兩張表同樣匯出
-- 順序：先把程式退回不呼叫房卡的版本（88034d3），再跑這份。這份只動房卡的物件，不碰任何其他表。
begin;
drop function if exists public.room_card_charged_since(timestamptz);
drop function if exists public.room_card_players();
drop function if exists public.room_card_set_suspended(text, uuid, boolean, uuid, timestamptz);
drop function if exists public.room_card_reclaim(text, uuid, integer, uuid, timestamptz);
drop function if exists public.room_card_topup(text, uuid, integer, uuid, timestamptz);
drop function if exists public.room_card_adjust(text, text, uuid, integer, uuid, timestamptz);
drop function if exists public.room_card_charge(text, text, text, integer, uuid[], timestamptz);
drop table if exists public.room_card_ops;
drop table if exists public.room_card_audit;
drop table if exists public.room_card_ledger;
drop table if exists public.room_card_accounts;
drop function if exists public.room_card_append_only();
commit;

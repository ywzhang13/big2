-- 回滾 20261120_room_cards_ledger_all.sql：刪掉唯讀函式 room_card_ledger_all。不碰任何資料。先把程式退回不呼叫 /api/admin/cards/ledger/all 的版本再跑。
begin;
drop function if exists public.room_card_ledger_all(text, timestamptz, int, timestamptz, text, bigint, uuid);
commit;

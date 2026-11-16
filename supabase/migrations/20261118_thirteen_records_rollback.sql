-- 回滾 20261118_thirteen_records.sql：刪掉 th_my_matches（只讀函式，沒有資料要還原）。
-- 先把程式退回不含 /api/thirteen/records 的版本，再跑這份。
begin;
drop function if exists public.th_my_matches(uuid, int, timestamptz, uuid);
commit;

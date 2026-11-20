-- 回滾 20261120_match_history.sql：刪掉唯讀函式 my_matches。不碰任何資料。先把程式退回不呼叫 /api/records 的版本再跑。
begin;
drop function if exists public.my_matches(uuid, text, int, timestamptz, uuid);
commit;

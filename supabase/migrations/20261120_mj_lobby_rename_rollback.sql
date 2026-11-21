-- 回滾 20261120_mj_lobby_rename.sql：刪掉 mj_lobby_rename。⚠️ 要先把程式退回不呼叫這個函式的版本，不然等人時改名會 500。
begin;
drop function if exists public.mj_lobby_rename(uuid, text, text);
commit;

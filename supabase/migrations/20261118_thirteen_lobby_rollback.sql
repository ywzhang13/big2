-- 回滾 20261118_thirteen_lobby.sql：刪掉 th_lobby_join、th_lobby_leave（不動任何資料）。
-- 先把程式退回不含這兩個函式的版本（入座、離開改回舊寫法），再跑這份。
begin;
drop function if exists public.th_lobby_join(uuid, text, text, uuid);
drop function if exists public.th_lobby_leave(uuid, uuid);
commit;

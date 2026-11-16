-- 回滾 20261113_mahjong_chat_history.sql：只刪那份新增的表和 4 個函式（聊天紀錄一起刪掉）。
-- 冷卻表 mj_chat_rate、mj_chat_take、語音 bucket 都不動（屬於 20261023）。
-- 回滾前請先把程式退回不寫聊天紀錄的版本，否則送文字會因為找不到 mj_chat_post 而失敗。
begin;
drop function if exists public.mj_chat_history(text);
drop function if exists public.mj_chat_post(text, text, text, int, int, int, int, jsonb, int, timestamptz);
drop function if exists public.mj_chat_append(text, jsonb, int, timestamptz);
drop function if exists public.mj_chat_lock_room(text);
drop table if exists public.mj_chat_messages;
commit;

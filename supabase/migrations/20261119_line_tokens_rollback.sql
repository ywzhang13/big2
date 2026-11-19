-- 回滾 20261119_line_tokens.sql：刪掉 line_tokens、line_refresh_state 兩張表、序號 line_tokens_gen_seq 和五個函式。
-- 先把程式退回不呼叫 /api/auth/line-token、/api/auth/refresh-picture 的版本，再跑這份。
-- 已存的 LINE 授權和冷卻紀錄會一起刪掉（只有加密的 token 和時間，沒有別的資料）；之後照片失效就回到「重新登入才會更新」。
begin;
drop function if exists public.line_token_save(uuid, text, text);
drop function if exists public.line_token_claim(uuid, int, timestamptz);
drop function if exists public.line_token_rotate(uuid, text, bigint);
drop function if exists public.line_token_invalidate(uuid, bigint);
drop function if exists public.line_token_delete(uuid, text);
drop table if exists public.line_tokens;
drop table if exists public.line_refresh_state;
drop sequence if exists public.line_tokens_gen_seq;
commit;

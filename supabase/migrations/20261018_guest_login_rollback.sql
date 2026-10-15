-- 回滾 20261018_guest_login.sql：只移除那份新增的表和函式（猜錯紀錄會一起刪掉，沒有其他資料受影響）。
-- 先把程式退回沒有遊客登入的版本，再跑這份。
begin;
drop function if exists guest_login_fail(text, int, int, int);
drop function if exists guest_login_locked_until(text);
drop table if exists guest_login_attempts;
commit;

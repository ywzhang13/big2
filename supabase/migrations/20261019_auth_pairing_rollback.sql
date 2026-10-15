-- 回滾 20261019_auth_pairing.sql：只移除那份新增的表和函式（等待中的配對會一起刪掉，最多影響 3 分鐘內正在登入的人）。
-- 先把程式退回沒有主畫面登入交接的版本，再跑這份。
begin;
drop function if exists auth_pairing_poll_fail(text);
drop table if exists auth_pairings;
commit;

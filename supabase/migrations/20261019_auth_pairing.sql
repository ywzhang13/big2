-- iPhone 主畫面 App 的 LINE 登入交接（2026-10-19）
-- 主畫面（獨立模式）和 Safari 的登入狀態是分開的：Safari 完成 LINE 登入後，用一次性的配對代碼把登入交回主畫面 App。
-- 只新增一張表和一個函式，不改任何現有的表；只有伺服器（service role）能用。猜錯次數沿用 guest_login_attempts。
-- 回滾：20261019_auth_pairing_rollback.sql
begin;

-- 只存雜湊，不存代碼本身；登入憑證加密後才存，被領走或過期就刪掉
create table if not exists auth_pairings (
  code_hash text primary key,          -- sha256(配對代碼)：代碼會出現在 Safari 的網址
  poll_hash text not null,             -- sha256(領取密鑰)：密鑰只留在發起的主畫面 App
  status text not null default 'pending' check (status in ('pending', 'ready')),
  user_id uuid,                        -- 認領的人（ready 後才有）
  payload text,                        -- 加密後的登入憑證（ready 後才有）
  poll_failures int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists auth_pairings_expires_at on auth_pairings (expires_at);
alter table auth_pairings enable row level security;   -- 不建 policy：公開金鑰讀寫不到

-- 領取密鑰錯一次：加一，回傳累計次數（同時送來的請求不會少算）
create or replace function auth_pairing_poll_fail(p_code_hash text) returns int
language sql as $$
  update auth_pairings set poll_failures = poll_failures + 1 where code_hash = p_code_hash returning poll_failures
$$;

revoke all on function auth_pairing_poll_fail(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on auth_pairings from anon, authenticated;
    revoke all on function auth_pairing_poll_fail(text) from anon, authenticated;
    grant execute on function auth_pairing_poll_fail(text) to service_role;
  end if;
end $$;

commit;

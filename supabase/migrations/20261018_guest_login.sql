-- 遊客登入（只給老闆自己測試用）：測試密碼猜錯的次數限制（2026-10-18）
-- 只新增一張表和兩個函式，不改任何現有的表；只有伺服器（service role）能用。
-- 回滾：20261018_guest_login_rollback.sql
begin;

-- 每個 key（某個 IP，或全站共用的 'global'）在一段時間內猜錯幾次、鎖到什麼時候
create table if not exists guest_login_attempts (
  key text primary key,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table guest_login_attempts enable row level security;   -- 不建 policy：公開金鑰讀寫不到

-- 現在是否鎖住：回傳鎖到的時間，沒鎖回 null
create or replace function guest_login_locked_until(p_key text) returns timestamptz
language sql stable as $$
  select locked_until from guest_login_attempts where key = p_key and locked_until > now()
$$;

-- 記一次猜錯：同一個 key 在 p_window_seconds 內累積到 p_max 次就鎖 p_lock_seconds 秒；回傳鎖到的時間（沒鎖回 null）
-- 先鎖住那一列再改，同時送來的請求不會少算
create or replace function guest_login_fail(p_key text, p_max int, p_window_seconds int, p_lock_seconds int)
returns timestamptz language plpgsql as $$
declare
  r guest_login_attempts;
begin
  insert into guest_login_attempts (key) values (p_key) on conflict (key) do nothing;
  select * into r from guest_login_attempts where key = p_key for update;
  if r.window_start < now() - make_interval(secs => p_window_seconds) then
    r.failures := 0;
    r.window_start := now();
  end if;
  r.failures := r.failures + 1;
  if r.failures >= p_max then
    r.locked_until := now() + make_interval(secs => p_lock_seconds);
    r.failures := 0;
    r.window_start := now();
  end if;
  update guest_login_attempts
     set failures = r.failures, window_start = r.window_start, locked_until = r.locked_until
   where key = p_key;
  return case when r.locked_until > now() then r.locked_until else null end;
end $$;

-- 只有伺服器能呼叫
revoke all on function guest_login_locked_until(text) from public;
revoke all on function guest_login_fail(text, int, int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on guest_login_attempts from anon, authenticated;
    revoke all on function guest_login_locked_until(text) from anon, authenticated;
    revoke all on function guest_login_fail(text, int, int, int) from anon, authenticated;
    grant execute on function guest_login_locked_until(text) to service_role;
    grant execute on function guest_login_fail(text, int, int, int) to service_role;
  end if;
end $$;

commit;

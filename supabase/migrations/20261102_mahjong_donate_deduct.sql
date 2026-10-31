-- 麻將斗內卡：看過才收起、後台手動清除、記一筆斗內自動抵扣（2026-10-31，老闆定案；小宜〈斗內卡收起與後台自摸次數〉第 4 節）
--
-- 規則：
--   ・自摸一次 NT$10（固定）。目前次數＝結轉次數（carried）＋歸零點（acked_at）之後的自摸次數
--   ・老闆記一筆斗內 NT$X：抵扣 min(目前次數, X ÷ 10 取整) 次，剩下的次數繼續欠（存進 carried）；
--     超過應斗的部分和不滿 NT$10 的零頭都算打賞，不預存。記帳和抵扣在同一個交易。作廢斗內不還原次數（照舊）
--   ・老闆在後台「清除」：次數直接歸零，寫一筆 zimo_clear 操作紀錄；已經是 0 不寫任何東西
--   ・玩家看過斗內卡（收起）：記下 seen_count＝看過幾次，不改次數；卡片在「次數 > 看過」時才出現。
--     次數被抵扣或清除變少時，seen_count 跟著降到不超過新的次數；之後再自摸、次數變多，卡片照常出現
--
-- 只新增、不改舊資料：
--   ① mj_donate_acks 加 4 個欄位（carried、seen_count 預設 0；reset_source、reset_cleared 預設 null）。舊列加上預設值後次數不變
--   ② mj_fx_audit 的 action 多允許 'zimo_clear'（只放寬檢查，舊紀錄不動）
--   ③ 改寫 mj_donate_count（加上 carried）、mj_donation_add（從「歸零」改成「抵扣」，回傳值不變）；舊版本體在回滾檔裡
--   ④ 新函式：mj_donation_record（記帳＋抵扣，回傳抵扣結果）、mj_zimo_clear、mj_donate_seen、mj_donate_status、mj_zimo_counts
-- 權限：新函式只給 service_role；最後自我檢查不成立就丟錯，整份不生效。回滾見 20261102_mahjong_donate_deduct_rollback.sql。
-- 前提：20261021_mahjong_donate.sql、20261031_mahjong_zimo_fx.sql 已經套用，否則整份拒絕。新函式加標記註解 'mj_donate_deduct:20261102'。
begin;

do $$
declare
  v_marker constant text := 'mj_donate_deduct:20261102';
  f text;
begin
  if to_regclass('public.mj_donate_acks') is null or obj_description(to_regclass('public.mj_donate_acks'), 'pg_class') is distinct from 'mj_donate:20261021' then
    raise exception '拒絕套用：請先套用 20261021_mahjong_donate.sql';
  end if;
  if to_regclass('public.mj_fx_audit') is null or obj_description(to_regclass('public.mj_fx_audit'), 'pg_class') is distinct from 'mj_zimo_fx:20261031' then
    raise exception '拒絕套用：請先套用 20261031_mahjong_zimo_fx.sql';
  end if;
  foreach f in array array['mj_donation_record', 'mj_zimo_clear', 'mj_donate_seen', 'mj_donate_status', 'mj_zimo_counts', 'mj_donate_settle'] loop
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f
               and obj_description(oid, 'pg_proc') is distinct from v_marker) then
      raise exception '拒絕套用：public.% 已經存在，而且不是這份 migration 建的', f;
    end if;
  end loop;
end $$;

-- ① 欄位
alter table public.mj_donate_acks
  add column if not exists carried int not null default 0,
  add column if not exists seen_count int not null default 0,
  add column if not exists reset_source text,
  add column if not exists reset_cleared int;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.mj_donate_acks'::regclass and conname = 'mj_donate_acks_deduct_check') then
    alter table public.mj_donate_acks add constraint mj_donate_acks_deduct_check
      check (carried >= 0 and seen_count >= 0 and (reset_source is null or reset_source in ('donation', 'clear')) and (reset_cleared is null or reset_cleared >= 0));
  end if;
end $$;

-- ② 操作紀錄多一種 action（找出現有 action 檢查換掉；名稱不寫死）
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.mj_fx_audit'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%action%' loop
    execute format('alter table public.mj_fx_audit drop constraint %I', c);
  end loop;
  alter table public.mj_fx_audit add constraint mj_fx_audit_action_check
    check (action in ('donation_add', 'donation_void', 'fx_grant', 'fx_revoke', 'fx_select', 'zimo_clear'));
end $$;

-- ③ 目前次數＝結轉＋歸零點之後的自摸
create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce((select a.carried from mj_donate_acks a where a.user_id = p_user_id), 0)
    + (select count(*)::int from mj_zimo_wins w
       where w.user_id = p_user_id
         and w.won_at > coalesce((select a.acked_at from mj_donate_acks a where a.user_id = p_user_id), '-infinity'::timestamptz))
$$;

-- 抵扣／清除的共用核心（內部用）：鎖住這位玩家的歸零列，算出到 p_now 為止的次數，扣掉 p_deduct 次（null＝全部），
-- 剩下的存進 carried、歸零點移到 p_now；seen_count 降到不超過剩下的次數。回傳 (before, deducted, remaining)
create or replace function public.mj_donate_settle(p_user uuid, p_deduct int, p_source text, p_now timestamptz)
returns table (before int, deducted int, remaining int)
language plpgsql
set search_path = public
as $$
declare
  v_row mj_donate_acks%rowtype;
  v_before int;
  v_deduct int;
begin
  insert into mj_donate_acks (user_id, acked_at) values (p_user, '-infinity') on conflict (user_id) do nothing;
  select * into v_row from mj_donate_acks where user_id = p_user for update;
  -- 只算到 p_now 為止的自摸：之後才記進來的那局留給下一輪，不會被抵扣兩次
  v_before := v_row.carried + (select count(*)::int from mj_zimo_wins w
                               where w.user_id = p_user and w.won_at > v_row.acked_at and w.won_at <= p_now);
  v_deduct := least(v_before, greatest(coalesce(p_deduct, v_before), 0));
  update mj_donate_acks set
    acked_at = greatest(acked_at, p_now),
    carried = v_before - v_deduct,
    seen_count = least(seen_count, v_before - v_deduct),
    reset_source = p_source,
    reset_cleared = v_deduct
  where user_id = p_user;
  return query select v_before, v_deduct, v_before - v_deduct;
end $$;

-- 記一筆斗內＋自動抵扣（同一個交易，連同操作紀錄）。回傳 { id, before, deducted, remaining, tip, price }
create or replace function public.mj_donation_record(
  p_actor text, p_user text, p_name text, p_avatar text, p_amount int, p_donated_at timestamptz, p_note text,
  p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_price constant int := 10;  -- 自摸一次 NT$10（老闆 2026-10-21／10-31 固定）
  v_now timestamptz := coalesce(p_now, now());
  v_id uuid;
  s record;
  v_tip int;
begin
  insert into mj_donations (user_id, player_name, player_avatar, amount, donated_at, note, created_by, created_at)
  values (p_user, p_name, p_avatar, p_amount, p_donated_at, coalesce(p_note, ''), p_actor, v_now)
  returning id into v_id;
  select * into s from public.mj_donate_settle(p_user::uuid, p_amount / v_price, 'donation', v_now);
  v_tip := p_amount - s.deducted * v_price;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_add', p_user, v_id,
          jsonb_build_object('amount', p_amount, 'donated_at', p_donated_at, 'note', coalesce(p_note, ''), 'price', v_price,
                             'before', s.before, 'deducted', s.deducted, 'remaining', s.remaining, 'tip', v_tip, 'cleared', s.deducted));
  return jsonb_build_object('id', v_id, 'before', s.before, 'deducted', s.deducted, 'remaining', s.remaining, 'tip', v_tip, 'price', v_price);
end $$;

-- 舊介面照樣能用（部署空檔裡舊程式呼叫也是抵扣）：回傳新紀錄 id
create or replace function public.mj_donation_add(
  p_actor text, p_user text, p_name text, p_avatar text, p_amount int, p_donated_at timestamptz, p_note text,
  p_now timestamptz default null
) returns uuid
language sql
set search_path = public
as $$
  select (public.mj_donation_record(p_actor, p_user, p_name, p_avatar, p_amount, p_donated_at, p_note, p_now) ->> 'id')::uuid
$$;

-- 後台清除：次數歸零（連同 zimo_clear 操作紀錄）。回傳清掉幾次；已經是 0 回 0，什麼都不寫
create or replace function public.mj_zimo_clear(p_actor text, p_user text, p_now timestamptz default null)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s record;
begin
  if public.mj_donate_count(p_user::uuid) = 0 then return 0; end if;
  select * into s from public.mj_donate_settle(p_user::uuid, null, 'clear', v_now);
  if s.deducted = 0 then return 0; end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'zimo_clear', p_user, jsonb_build_object('cleared', s.deducted));
  return s.deducted;
end $$;

-- 玩家看過斗內卡：seen_count＝max(原本, min(看到的數字, 目前次數))，不改次數。回傳目前次數和看過次數
create or replace function public.mj_donate_seen(p_user uuid, p_count int)
returns table (count int, seen int)
language plpgsql
set search_path = public
as $$
declare
  v_count int := public.mj_donate_count(p_user);
begin
  insert into mj_donate_acks (user_id, acked_at) values (p_user, '-infinity') on conflict (user_id) do nothing;
  update mj_donate_acks a set seen_count = greatest(a.seen_count, least(greatest(p_count, 0), v_count)) where a.user_id = p_user;
  return query select v_count, a.seen_count from mj_donate_acks a where a.user_id = p_user;
end $$;

-- 斗內卡要不要出現：目前次數和看過次數
create or replace function public.mj_donate_status(p_user uuid)
returns table (count int, seen int)
language sql
stable
set search_path = public
as $$
  select public.mj_donate_count(p_user), coalesce((select a.seen_count from mj_donate_acks a where a.user_id = p_user), 0)
$$;

-- 後台「自摸次數」清單：有自摸紀錄、或曾經被歸零過的帳號（遊客、名稱由伺服器用 LINE 帳號資料過濾和補上）
create or replace function public.mj_zimo_counts()
returns table (user_id uuid, count int, last_reset_at timestamptz, last_reset_source text, last_reset_cleared int)
language sql
stable
set search_path = public
as $$
  select u.user_id, public.mj_donate_count(u.user_id),
         case when a.acked_at = '-infinity' then null else a.acked_at end, a.reset_source, a.reset_cleared
  from (select w.user_id from mj_zimo_wins w union select x.user_id from mj_donate_acks x where x.acked_at <> '-infinity') u
  left join mj_donate_acks a on a.user_id = u.user_id
$$;

comment on function public.mj_donate_settle(uuid, int, text, timestamptz) is 'mj_donate_deduct:20261102';
comment on function public.mj_donation_record(text, text, text, text, int, timestamptz, text, timestamptz) is 'mj_donate_deduct:20261102';
comment on function public.mj_zimo_clear(text, text, timestamptz) is 'mj_donate_deduct:20261102';
comment on function public.mj_donate_seen(uuid, int) is 'mj_donate_deduct:20261102';
comment on function public.mj_donate_status(uuid) is 'mj_donate_deduct:20261102';
comment on function public.mj_zimo_counts() is 'mj_donate_deduct:20261102';

revoke all on function public.mj_donate_settle(uuid, int, text, timestamptz), public.mj_donation_record(text, text, text, text, int, timestamptz, text, timestamptz),
  public.mj_zimo_clear(text, text, timestamptz), public.mj_donate_seen(uuid, int), public.mj_donate_status(uuid), public.mj_zimo_counts(),
  public.mj_donate_count(uuid), public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mj_donation_record(text, text, text, text, int, timestamptz, text, timestamptz),
  public.mj_zimo_clear(text, text, timestamptz), public.mj_donate_seen(uuid, int), public.mj_donate_status(uuid), public.mj_zimo_counts(),
  public.mj_donate_count(uuid), public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz)
  to service_role;

-- 自我檢查：公開金鑰不能執行任何一支；表照樣不能讀寫
do $$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach f in array array['public.mj_donate_settle(uuid, int, text, timestamptz)', 'public.mj_donation_record(text, text, text, text, int, timestamptz, text, timestamptz)',
                             'public.mj_zimo_clear(text, text, timestamptz)', 'public.mj_donate_seen(uuid, int)', 'public.mj_donate_status(uuid)', 'public.mj_zimo_counts()',
                             'public.mj_donate_count(uuid)', 'public.mj_donation_add(text, text, text, text, int, timestamptz, text, timestamptz)'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '斗內抵扣函式鎖權限沒有完成：% 還能執行 %，整份不生效', r, f;
      end if;
    end loop;
    if has_table_privilege(r, 'public.mj_donate_acks', 'select') or has_table_privilege(r, 'public.mj_donate_acks', 'update') then
      raise exception 'mj_donate_acks 權限不對：% 能讀寫，整份不生效', r;
    end if;
  end loop;
end $$;

commit;

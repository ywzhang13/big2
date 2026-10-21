-- 麻將「斗內給阿瑋」：每個 LINE 帳號累計自己的自摸次數，按斗內後歸零（2026-10-21）
--
-- 為什麼要新表：現有的對局紀錄（match_records）只在整場結束時寫一次總輸贏，沒有「哪一局誰自摸」，
--   所以改成每局結算存檔時，記下這局自摸胡的人。
-- 新增：
--   ① mj_zimo_wins：一筆＝一個帳號在某房某局自摸胡（主鍵 room_id＋hand_no＋user_id，同一局重複存檔只記一次）
--   ② mj_donate_acks：每個帳號最後一次按斗內的時間（歸零點）
--   ③ mj_zimo_record()：記下一局的自摸者；mj_donate_count()：歸零點之後的自摸次數；mj_donate_ack()：把歸零點設成現在
-- 起算時間：不另外設常數。這張表在功能上線時是空的，上線前的自摸沒有記錄，所以上線那一刻大家都是 0。
-- 訪客：不記錄。mj_zimo_record 以 auth.users 為準，只寫入存在、而且不是遊客（app_metadata.guest）的帳號；
--   伺服器路由也不幫訪客計數、不歸零。帳號刪除時，兩張表的資料由外鍵一起刪（on delete cascade）。
-- 需要 auth.users（Supabase 內建）：找不到就整份拒絕，不會默默跳過外鍵。
-- 和付款無關：只記次數和時間。
--
-- 權限：表和函式只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   最後的自我檢查不成立就丟錯，整份不生效。只新增、不改現有資料表；回滾見 20261021_mahjong_donate_rollback.sql。
-- 既有同名物件：這份建立的表、函式都加上標記註解 'mj_donate:20261021'。套用前如果 public 已經有同名的表、
--   索引或函式卻沒有這個標記，就整份拒絕、什麼都不改；重跑這份時看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_donate:20261021';
  t text;
  f text;
begin
  foreach t in array array['mj_zimo_wins', 'mj_donate_acks'] loop
    if to_regclass('public.' || t) is not null and obj_description(to_regclass('public.' || t), 'pg_class') is distinct from v_marker then
      raise exception '拒絕套用：public.% 已經存在，而且不是這份 migration 建的；請先確認那張表的用途', t;
    end if;
  end loop;
  -- 索引名稱也不能被別的表佔用
  foreach t in array array['mj_zimo_wins_pkey', 'mj_zimo_wins_user', 'mj_donate_acks_pkey'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_index i where i.indexrelid = to_regclass('public.' || t)
        and obj_description(i.indrelid, 'pg_class') is not distinct from v_marker) then
      raise exception '拒絕套用：public.% 已經存在，而且不是這份 migration 建的', t;
    end if;
  end loop;
  foreach f in array array['mj_zimo_record', 'mj_donate_count', 'mj_donate_ack'] loop
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f
               and obj_description(oid, 'pg_proc') is distinct from v_marker) then
      raise exception '拒絕套用：public.% 已經存在，而且不是這份 migration 建的；請先確認那個函式的用途', f;
    end if;
  end loop;
  if to_regclass('auth.users') is null then
    raise exception '拒絕套用：找不到 auth.users（自摸紀錄要用外鍵跟著帳號刪除、也要用它排除遊客）';
  end if;
end $$;

create table if not exists public.mj_zimo_wins (
  room_id uuid not null,       -- 原房間 id（房間會被刪，不設外鍵）
  hand_no int not null,        -- 這間房的第幾局（牌局狀態的 handsCompleted）
  user_id uuid not null,       -- 自摸胡的帳號
  won_at timestamptz not null default now(),
  primary key (room_id, hand_no, user_id)
);
create index if not exists mj_zimo_wins_user on public.mj_zimo_wins (user_id, won_at);

create table if not exists public.mj_donate_acks (
  user_id uuid primary key,
  acked_at timestamptz not null
);

-- 帳號刪除（例如過期遊客被清掉）時一起刪。判斷「這張表上有沒有正確的外鍵」看的是實際定義
-- （user_id → auth.users(id)、on delete cascade），不是只看名稱：別的表剛好有同名的限制也不會被誤判成已經建好。
do $$
declare
  t text;
  v_name text;
begin
  foreach t in array array['mj_zimo_wins', 'mj_donate_acks'] loop
    v_name := t || '_user_id_fkey';
    if not exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
      where c.conrelid = ('public.' || t)::regclass and c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'
    ) then
      if exists (select 1 from pg_constraint where conrelid = ('public.' || t)::regclass and conname = v_name) then
        raise exception '拒絕套用：public.% 上已經有名為 % 的限制，但不是指向 auth.users 的外鍵', t, v_name;
      end if;
      execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users (id) on delete cascade', t, v_name);
    end if;
  end loop;
end $$;

-- 記下一局的自摸者：同一局重複呼叫（重送、同一個結算狀態再存檔）不會多記；遊客、不存在的帳號不記。回傳這次新記了幾筆。
-- p_now 只給測試用，正式一律用資料庫時間。
-- SECURITY DEFINER：要讀 auth.users 判斷遊客（service_role 不一定讀得到 auth schema），以套用者（postgres）身分執行；
--   search_path 固定、執行權限只給 service_role（見下面的 revoke／grant）。
create or replace function public.mj_zimo_record(p_room_id uuid, p_hand_no int, p_user_ids uuid[], p_now timestamptz default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  -- 只記存在、而且不是遊客的帳號（遊客的標記在 app_metadata，只有 service role 改得了）
  insert into mj_zimo_wins (room_id, hand_no, user_id, won_at)
  select distinct p_room_id, p_hand_no, u.id, coalesce(p_now, now())
  from unnest(p_user_ids) as x(id) join auth.users u on u.id = x.id
  where coalesce(u.raw_app_meta_data ->> 'guest', '') <> 'true'
  on conflict (room_id, hand_no, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 歸零點之後的自摸次數（沒有歸零點＝從有紀錄開始算）
create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from mj_zimo_wins w
  where w.user_id = p_user_id
    and w.won_at > coalesce((select a.acked_at from mj_donate_acks a where a.user_id = p_user_id), '-infinity'::timestamptz)
$$;

-- 把歸零點設成現在（連按、重送都一樣：只會往後移，不會倒退），回傳歸零後的次數
create or replace function public.mj_donate_ack(p_user_id uuid, p_now timestamptz default null)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  insert into mj_donate_acks (user_id, acked_at) values (p_user_id, v_now)
  on conflict (user_id) do update set acked_at = greatest(mj_donate_acks.acked_at, excluded.acked_at);
  return public.mj_donate_count(p_user_id);
end $$;

comment on table public.mj_zimo_wins is 'mj_donate:20261021';
comment on table public.mj_donate_acks is 'mj_donate:20261021';
comment on function public.mj_zimo_record(uuid, int, uuid[], timestamptz) is 'mj_donate:20261021';
comment on function public.mj_donate_count(uuid) is 'mj_donate:20261021';
comment on function public.mj_donate_ack(uuid, timestamptz) is 'mj_donate:20261021';

-- 權限：只給 service_role
alter table public.mj_zimo_wins enable row level security;
alter table public.mj_donate_acks enable row level security;
revoke all on table public.mj_zimo_wins, public.mj_donate_acks from public, anon, authenticated;
grant select, insert, update, delete on table public.mj_zimo_wins, public.mj_donate_acks to service_role;
revoke all on function public.mj_zimo_record(uuid, int, uuid[], timestamptz), public.mj_donate_count(uuid), public.mj_donate_ack(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mj_zimo_record(uuid, int, uuid[], timestamptz), public.mj_donate_count(uuid), public.mj_donate_ack(uuid, timestamptz)
  to service_role;

-- 自我檢查：公開金鑰對兩張表（任何操作）、三個函式都不能有權限，表上不能有 policy，兩張表都要有正確的外鍵
do $$
declare
  r text;
  t text;
  p text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['public.mj_zimo_wins', 'public.mj_donate_acks'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, t, p) then
          raise exception '斗內資料表鎖權限沒有完成：% 對 % 還有 %，整份不生效', r, t, p;
        end if;
      end loop;
    end loop;
    foreach f in array array['public.mj_zimo_record(uuid, int, uuid[], timestamptz)', 'public.mj_donate_count(uuid)', 'public.mj_donate_ack(uuid, timestamptz)'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '斗內函式鎖權限沒有完成：% 還能執行 %，整份不生效', r, f;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('mj_zimo_wins', 'mj_donate_acks')) then
    raise exception '斗內資料表不應該有 policy，整份不生效';
  end if;
  foreach t in array array['mj_zimo_wins', 'mj_donate_acks'] loop
    if not exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
      where c.conrelid = ('public.' || t)::regclass and c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'
    ) then
      raise exception '斗內資料表 % 沒有指向 auth.users 的外鍵（on delete cascade），整份不生效', t;
    end if;
  end loop;
end $$;

commit;

-- 麻將偏好設定跟著 LINE 帳號走（2026-10-22）：只存外觀（牌背、桌布；牌面底色不開放，固定原本的白色），聲音和互動開關仍只存在各自的裝置。
--
-- 新增：mj_user_prefs：一個帳號一列。prefs 的格式由伺服器白名單驗證後才寫入（lib/mahjong/userPrefs/rules.ts），
--   資料庫這邊另外擋格式 v2：一定是 JSON 物件、剛好只有 v、back、felt 三個鍵（帶 face 或其他鍵都寫不進去）、
--   v = 2、back 和 felt 是字串、不超過 1KB。值的白名單只在伺服器那邊（改選項不用動資料庫）。
-- 訪客：伺服器路由不幫訪客存（回 persisted:false，前端用本機設定）。帳號刪除時這一列由外鍵一起刪（on delete cascade）。
-- 需要 auth.users（Supabase 內建）：找不到就整份拒絕，不會默默跳過外鍵。
--
-- 權限：表只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   最後的自我檢查不成立就丟錯，整份不生效。只新增、不改現有資料表；回滾見 20261022_mahjong_prefs_rollback.sql。
-- 既有同名物件：這份建立的表加上標記註解 'mj_prefs:20261022'。套用前如果 public 已經有同名的表或索引卻沒有這個標記，
--   就整份拒絕、什麼都不改；重跑這份時看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_prefs:20261022';
begin
  if to_regclass('public.mj_user_prefs') is not null
     and obj_description(to_regclass('public.mj_user_prefs'), 'pg_class') is distinct from v_marker then
    raise exception '拒絕套用：public.mj_user_prefs 已經存在，而且不是這份 migration 建的；請先確認那張表的用途';
  end if;
  if to_regclass('public.mj_user_prefs_pkey') is not null and not exists (
    select 1 from pg_index i where i.indexrelid = to_regclass('public.mj_user_prefs_pkey')
      and obj_description(i.indrelid, 'pg_class') is not distinct from v_marker) then
    raise exception '拒絕套用：public.mj_user_prefs_pkey 已經存在，而且不是這份 migration 建的';
  end if;
  if to_regclass('auth.users') is null then
    raise exception '拒絕套用：找不到 auth.users（偏好設定要用外鍵跟著帳號刪除）';
  end if;
end $$;

create table if not exists public.mj_user_prefs (
  user_id uuid primary key,
  -- 用 case 保證先確認是物件，才做取鍵、刪鍵（純量做 jsonb - text[] 會直接丟錯，不是違反 check）
  prefs jsonb not null check (case when jsonb_typeof(prefs) = 'object' then
    prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb
    and prefs -> 'v' = '2'::jsonb and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
    and pg_column_size(prefs) <= 1024
  else false end),
  updated_at timestamptz not null default now()
);

-- 帳號刪除時一起刪。判斷「有沒有正確的外鍵」看實際定義（user_id → auth.users(id)、on delete cascade），不是只看名稱
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
    where c.conrelid = 'public.mj_user_prefs'::regclass and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'
  ) then
    if exists (select 1 from pg_constraint where conrelid = 'public.mj_user_prefs'::regclass and conname = 'mj_user_prefs_user_id_fkey') then
      raise exception '拒絕套用：public.mj_user_prefs 上已經有名為 mj_user_prefs_user_id_fkey 的限制，但不是指向 auth.users 的外鍵';
    end if;
    alter table public.mj_user_prefs add constraint mj_user_prefs_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;

comment on table public.mj_user_prefs is 'mj_prefs:20261022';

-- 權限：只給 service_role
alter table public.mj_user_prefs enable row level security;
revoke all on table public.mj_user_prefs from public, anon, authenticated;
grant select, insert, update, delete on table public.mj_user_prefs to service_role;

-- 自我檢查：公開金鑰對表不能有任何權限、表上不能有 policy、外鍵要正確
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_user_prefs', p) then
        raise exception '偏好設定表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mj_user_prefs') then
    raise exception '偏好設定表不應該有 policy，整份不生效';
  end if;
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'user_id'
    where c.conrelid = 'public.mj_user_prefs'::regclass and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass and c.conkey = array[a.attnum] and c.confdeltype = 'c'
  ) then
    raise exception '偏好設定表沒有指向 auth.users 的外鍵（on delete cascade），整份不生效';
  end if;
end $$;

commit;

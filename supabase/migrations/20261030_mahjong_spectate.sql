-- 麻將觀戰模式（2026-10-30）：觀戰申請、同意、收回
--
-- 規則（數字由伺服器傳入，見 lib/mahjong/spectate/rules.ts）：
--   ・只有 LINE 登入的人能申請（伺服器檢查）；同一位觀戰者對同一位玩家只有一列，狀態 pending → approved／rejected，approved → revoked
--   ・申請 30 秒沒回應就失效；同一位觀戰者對同一位玩家，從上一次申請起 30 秒內不能再申請（以資料庫時間為準）
--   ・approved 一直有效到房間結束（房間關閉時伺服器刪掉這房的列）；被觀戰者可以隨時收回
--
-- 新增：
--   ① mj_spectate：每房、每位觀戰者、每位被觀戰玩家一列。spectator_id 是登入帳號 id，只在伺服器用，不送給前端
--   ② mj_spectate_request()：在同一個交易裡上鎖、檢查冷卻、寫入申請（多台伺服器同時收到也只會放行一次）
--   ③ mj_spectate_respond()：被觀戰者同意／拒絕；只改還在有效期內的 pending
--   ④ mj_spectate_revoke()：被觀戰者收回（單筆或全部）
--
-- 權限：表和函式只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   最後的自我檢查不成立就丟錯，整份不生效。只新增、不改現有資料表；回滾見 20261030_mahjong_spectate_rollback.sql。
--
-- 既有同名物件：這份建立的表、函式都加上標記註解 'mj_spectate:20261030'。
--   套用前如果 public 已經有同名的表或函式，卻不是這份建的，就整份拒絕、什麼都不改。重跑看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_spectate:20261030';
  v_tbl oid := to_regclass('public.mj_spectate');
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕套用：public.mj_spectate 已經存在，而且不是這份 migration 建的；請先確認那張表的用途';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('mj_spectate_request', 'mj_spectate_respond', 'mj_spectate_revoke')
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕套用：mj_spectate_request／respond／revoke 已經存在，而且不是這份 migration 建的';
  end if;
end $$;

create table if not exists public.mj_spectate (
  room_id text not null,
  spectator_id text not null,      -- 觀戰者的登入帳號 id（只在伺服器用）
  target_player_id text not null,  -- 被觀戰的座位（牌局裡的玩家 id）
  request_id uuid not null unique, -- 給被觀戰者回應、收回用（每次申請換一個）
  status text not null check (status in ('pending', 'approved', 'rejected', 'revoked')),
  spectator_name text not null,    -- 申請時的 LINE 本名（給被觀戰者辨識）
  spectator_avatar text,           -- 申請時的 LINE 頭像網址（https）
  requested_at timestamptz not null,
  responded_at timestamptz,
  primary key (room_id, spectator_id, target_player_id)
);
create index if not exists mj_spectate_room_target on public.mj_spectate (room_id, target_player_id, status);

-- 申請。回傳 jsonb：
--   放行 → {"ok":true,"request_id":"…","expires_at":"…"}（寫入／覆蓋成 pending）
--   擋下 → {"ok":false,"reason":"already_approved"} 或 {"ok":false,"reason":"already_pending"|"cooldown","until":"…"}，什麼都不寫
-- 互斥用交易內的 advisory lock（鎖「房＋觀戰者＋目標」），鎖住後才讀、判斷、寫。p_now 只給測試用，正式一律用資料庫時間。
create or replace function public.mj_spectate_request(
  p_room_id text,
  p_spectator_id text,
  p_target_id text,
  p_name text,
  p_avatar text,
  p_window_ms int,
  p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_win interval := make_interval(secs => p_window_ms / 1000.0);
  v_row mj_spectate%rowtype;
  v_req uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('mj_spectate:' || p_room_id || ':' || p_spectator_id || ':' || p_target_id, 0));
  select * into v_row from mj_spectate
  where room_id = p_room_id and spectator_id = p_spectator_id and target_player_id = p_target_id;
  if found then
    if v_row.status = 'approved' then
      return jsonb_build_object('ok', false, 'reason', 'already_approved');
    end if;
    if v_row.requested_at > v_now - v_win then
      return jsonb_build_object('ok', false,
        'reason', case when v_row.status = 'pending' then 'already_pending' else 'cooldown' end,
        'until', v_row.requested_at + v_win);
    end if;
  end if;
  insert into mj_spectate (room_id, spectator_id, target_player_id, request_id, status, spectator_name, spectator_avatar, requested_at, responded_at)
  values (p_room_id, p_spectator_id, p_target_id, v_req, 'pending', p_name, p_avatar, v_now, null)
  on conflict (room_id, spectator_id, target_player_id) do update
    set request_id = excluded.request_id, status = 'pending', spectator_name = excluded.spectator_name,
        spectator_avatar = excluded.spectator_avatar, requested_at = excluded.requested_at, responded_at = null;
  -- 房間關閉時伺服器會刪這房的列；漏刪的（超過一天）順手清掉
  delete from mj_spectate where requested_at < v_now - interval '1 day' and status <> 'approved';
  return jsonb_build_object('ok', true, 'request_id', v_req, 'expires_at', v_now + v_win);
end $$;

-- 同意／拒絕：只改這位被觀戰者、這個 request_id、還在有效期內的 pending。回傳 true＝有改到
create or replace function public.mj_spectate_respond(
  p_room_id text,
  p_target_id text,
  p_request_id uuid,
  p_approve boolean,
  p_window_ms int,
  p_now timestamptz default null
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  update mj_spectate
     set status = case when p_approve then 'approved' else 'rejected' end, responded_at = v_now
   where room_id = p_room_id and target_player_id = p_target_id and request_id = p_request_id
     and status = 'pending' and requested_at > v_now - make_interval(secs => p_window_ms / 1000.0);
  return found;
end $$;

-- 收回：p_request_id 為 null 時收回這位玩家的全部。回傳收回幾位
create or replace function public.mj_spectate_revoke(
  p_room_id text,
  p_target_id text,
  p_request_id uuid,
  p_now timestamptz default null
) returns int
language plpgsql
set search_path = public
as $$
declare
  v_n int;
begin
  update mj_spectate
     set status = 'revoked', responded_at = coalesce(p_now, now())
   where room_id = p_room_id and target_player_id = p_target_id and status = 'approved'
     and (p_request_id is null or request_id = p_request_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on table public.mj_spectate is 'mj_spectate:20261030';
comment on function public.mj_spectate_request(text, text, text, text, text, int, timestamptz) is 'mj_spectate:20261030';
comment on function public.mj_spectate_respond(text, text, uuid, boolean, int, timestamptz) is 'mj_spectate:20261030';
comment on function public.mj_spectate_revoke(text, text, uuid, timestamptz) is 'mj_spectate:20261030';

-- 權限：只給 service_role
alter table public.mj_spectate enable row level security;
revoke all on table public.mj_spectate from public, anon, authenticated;
grant select, insert, update, delete on table public.mj_spectate to service_role;
revoke all on function public.mj_spectate_request(text, text, text, text, text, int, timestamptz) from public, anon, authenticated;
revoke all on function public.mj_spectate_respond(text, text, uuid, boolean, int, timestamptz) from public, anon, authenticated;
revoke all on function public.mj_spectate_revoke(text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mj_spectate_request(text, text, text, text, text, int, timestamptz) to service_role;
grant execute on function public.mj_spectate_respond(text, text, uuid, boolean, int, timestamptz) to service_role;
grant execute on function public.mj_spectate_revoke(text, text, uuid, timestamptz) to service_role;

-- 自我檢查：公開金鑰對表（任何操作）、函式都不能有權限，表上不能有 policy
do $$
declare
  r text;
  p text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_spectate', p) then
        raise exception '觀戰表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
    foreach f in array array[
      'public.mj_spectate_request(text, text, text, text, text, int, timestamptz)',
      'public.mj_spectate_respond(text, text, uuid, boolean, int, timestamptz)',
      'public.mj_spectate_revoke(text, text, uuid, timestamptz)'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '觀戰函式鎖權限沒有完成：% 還能執行 %，整份不生效', r, f;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mj_spectate') then
    raise exception '觀戰表不應該有 policy，整份不生效';
  end if;
end $$;

commit;

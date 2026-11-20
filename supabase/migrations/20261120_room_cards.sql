-- 房卡（老柯 2026-11-20；規則：規劃 v1 第 2 節、小宜房卡設計說明 v1.2 第 4-5 節）。
-- 規則：每人各扣、開局就扣。麻將每一把開局扣 1 張、連莊那把不扣；十三支奇數局開局扣 1 張、偶數局不扣；大老二不扣；
--       老闆帳號不扣（程式端排除，不傳進來）；遊客不扣（這裡用 auth.users 的 app_metadata.guest 排除，同 mj_zimo_record）。
--       餘額可以是負數、沒有下限。同一人、同一款遊戲、同一房、同一把只扣一次（資料庫唯一索引擋，重送、同時請求都只成功一筆）。
--
-- 只新增、不改不刪任何現有的表和資料：
--   room_card_accounts  一人一列：餘額、暫停時間（null＝沒暫停）、暫停的人
--   room_card_ledger    流水帳，只能新增（觸發器擋改、擋刪）：充值 topup（+）、扣卡 charge（−1）、回收 reclaim（−）
--   room_card_audit     暫停／恢復紀錄，只能新增
--   room_card_ops       後台操作編號（充值、回收、暫停、恢復共用一張）：每個被接受的操作都先在這裡佔住編號（主鍵），
--                       連「狀態本來就一樣、什麼都沒改」的暫停／恢復也記，舊請求重送一律認得（審伯 2026-11-20 初審必修一）
-- 三張表都開 RLS、沒有 policy，PUBLIC／anon／authenticated 全部收回，只有 service_role 能讀寫（伺服器）。
--
-- 函式（只有 service_role 能執行；餘額和流水帳在同一個交易裡一起寫，不會有「扣了沒記」或「記了沒扣」）：
--   room_card_charge(遊戲, 房間 id, 房號, 第幾把, 帳號[], 現在) → 這次真的扣了幾個人
--   room_card_topup(操作的人, 帳號, 張數, 操作編號, 現在)    → jsonb { ok, balance, replay } ｜ { ok:false, error:'op_conflict' }
--   room_card_reclaim(操作的人, 帳號, 張數, 操作編號, 現在)  → 同上；可以收到負數
--   room_card_set_suspended(操作的人, 帳號, 暫停?, 操作編號, 現在) → jsonb { ok, suspendedAt, replay } ｜ { ok:false, error:'op_conflict' }
--   room_card_players()                                          → 每個有帳戶的人：餘額、暫停、上次充值、上次扣卡、正在打的房
--   room_card_charged_since(時間)                                → 這段時間扣了幾張（後台「今天扣卡」）
-- 操作編號（op_id）：後台每次按下產生一個，重送同一個只生效一次（不改帳、不改狀態），充值／回收回第一次的餘額、暫停／恢復回目前狀態；
-- 同一個編號換人、換動作、換張數回 op_conflict。編號用 room_card_ops 的主鍵佔位：兩個交易同時拿同一個編號，後到的等前一個結束再判斷，只會成功一個。
-- 回滾：20261120_room_cards_rollback.sql（刪掉這份新增的三張表和六個函式；已記的房卡帳一起刪掉，先確認不要了再跑）。
begin;

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception '拒絕套用：找不到 auth.users';
  end if;
  if to_regclass('public.mj_players') is null or to_regclass('public.th_players') is null then
    raise exception '拒絕套用：找不到 mj_players／th_players（先套麻將、十三支的 migration）';
  end if;
  if to_regclass('public.room_card_accounts') is not null or to_regclass('public.room_card_ledger') is not null
     or to_regclass('public.room_card_audit') is not null or to_regclass('public.room_card_ops') is not null then
    raise exception '拒絕套用：房卡的表已經存在（這份已經套用過）';
  end if;
end $$;

create table public.room_card_accounts (
  user_id uuid primary key,                           -- LINE 帳號（不加外鍵：帳號刪了帳還要留著）
  balance integer not null default 0,                 -- 可以是負數，沒有下限
  suspended_at timestamptz,                           -- null＝沒暫停
  suspended_by text,
  updated_at timestamptz not null default now()
);

create table public.room_card_ledger (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null check (kind in ('topup', 'charge', 'reclaim')),
  delta integer not null check ((kind = 'topup' and delta > 0) or (kind = 'charge' and delta = -1) or (kind = 'reclaim' and delta < 0)),
  balance_after integer not null,
  game text check (game in ('mahjong', 'thirteen')),  -- 扣卡才有
  room_id text,
  room_code text,
  hand_no integer,                                    -- 麻將：第幾把（打完的把數＋1）；十三支：第幾局
  actor text not null,                                -- 'system'（扣卡）或老闆帳號 id
  op_id uuid,                                         -- 後台操作編號（扣卡沒有）
  created_at timestamptz not null default now(),
  check ((kind = 'charge') = (game is not null and room_id is not null and hand_no is not null))
);
-- 同一人、同一款遊戲、同一房、同一把只能有一筆扣卡
create unique index room_card_ledger_charge_once on public.room_card_ledger (user_id, game, room_id, hand_no) where kind = 'charge';
create unique index room_card_ledger_op on public.room_card_ledger (op_id) where op_id is not null;
create index room_card_ledger_user on public.room_card_ledger (user_id, id desc);
create index room_card_ledger_time on public.room_card_ledger (created_at);

create table public.room_card_audit (
  id bigserial primary key,
  user_id uuid not null,
  action text not null check (action in ('suspend', 'resume')),
  actor text not null,
  op_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index room_card_audit_user on public.room_card_audit (user_id, id desc);

create table public.room_card_ops (
  op_id uuid primary key,
  user_id uuid not null,
  kind text not null check (kind in ('topup', 'reclaim', 'suspend', 'resume')),
  cards integer,                                      -- 充值、回收的張數；暫停、恢復是 null
  balance_after integer,                              -- 充值、回收做完的餘額（重送時回這個）
  actor text not null,
  created_at timestamptz not null default now()
);

-- 流水帳、暫停紀錄只能新增
create function public.room_card_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception '% 只能新增，不能修改或刪除', tg_table_name;
end $$;
create trigger room_card_ledger_append_only before update or delete on public.room_card_ledger
  for each row execute function public.room_card_append_only();
create trigger room_card_audit_append_only before update or delete on public.room_card_audit
  for each row execute function public.room_card_append_only();

alter table public.room_card_accounts enable row level security;
alter table public.room_card_ledger enable row level security;
alter table public.room_card_audit enable row level security;
alter table public.room_card_ops enable row level security;
revoke all on table public.room_card_accounts, public.room_card_ledger, public.room_card_audit, public.room_card_ops from public, anon, authenticated;
revoke all on sequence public.room_card_ledger_id_seq, public.room_card_audit_id_seq from public, anon, authenticated;
revoke all on function public.room_card_append_only() from public, anon, authenticated;

-- 扣卡：每個帳號各扣 1 張（遊客、重複的帳號、這一把已經扣過的跳過）。回傳這次真的扣了幾個人
create function public.room_card_charge(p_game text, p_room_id text, p_room_code text, p_hand_no integer, p_users uuid[], p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_user uuid;
  v_balance integer;
  v_n integer := 0;
begin
  if p_game not in ('mahjong', 'thirteen') or p_room_id is null or p_hand_no is null or p_hand_no < 1 then
    raise exception 'room_card_charge：參數不對';
  end if;
  for v_user in select distinct u from unnest(coalesce(p_users, '{}')) u where u is not null order by 1 loop
    if exists (select 1 from auth.users where id = v_user and coalesce(raw_app_meta_data->>'guest', '') = 'true') then
      continue; -- 遊客不扣
    end if;
    insert into room_card_accounts (user_id, updated_at) values (v_user, v_now) on conflict (user_id) do nothing;
    perform 1 from room_card_accounts where user_id = v_user for update; -- 同一人的扣卡、充值、回收排隊
    if exists (select 1 from room_card_ledger where user_id = v_user and kind = 'charge' and game = p_game and room_id = p_room_id and hand_no = p_hand_no) then
      continue; -- 這一把已經扣過
    end if;
    update room_card_accounts set balance = balance - 1, updated_at = v_now where user_id = v_user returning balance into v_balance;
    insert into room_card_ledger (user_id, kind, delta, balance_after, game, room_id, room_code, hand_no, actor, created_at)
    values (v_user, 'charge', -1, v_balance, p_game, p_room_id, p_room_code, p_hand_no, 'system', v_now);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 充值、回收共用：張數是正整數；回收寫成負的 delta，餘額可以變負數
create function public.room_card_adjust(p_kind text, p_actor text, p_user uuid, p_cards integer, p_op uuid, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_prev room_card_ops%rowtype;
  v_balance integer;
  v_delta integer;
begin
  if p_kind not in ('topup', 'reclaim') or p_user is null or p_op is null or p_cards is null or p_cards < 1 or p_cards > 100000 then
    raise exception 'room_card_adjust：參數不對';
  end if;
  v_delta := case when p_kind = 'topup' then p_cards else -p_cards end;
  insert into room_card_accounts (user_id, updated_at) values (p_user, v_now) on conflict (user_id) do nothing;
  perform 1 from room_card_accounts where user_id = p_user for update;
  insert into room_card_ops (op_id, user_id, kind, cards, actor, created_at) values (p_op, p_user, p_kind, p_cards, p_actor, v_now)
  on conflict (op_id) do nothing;
  if not found then -- 這個操作編號已經用過：同一件事是重送（回第一次的餘額，不再加減），不是同一件事回 op_conflict
    select * into v_prev from room_card_ops where op_id = p_op;
    if v_prev.user_id <> p_user or v_prev.kind <> p_kind or v_prev.cards is distinct from p_cards then
      return jsonb_build_object('ok', false, 'error', 'op_conflict');
    end if;
    return jsonb_build_object('ok', true, 'balance', v_prev.balance_after, 'replay', true);
  end if;
  update room_card_accounts set balance = balance + v_delta, updated_at = v_now where user_id = p_user returning balance into v_balance;
  update room_card_ops set balance_after = v_balance where op_id = p_op;
  insert into room_card_ledger (user_id, kind, delta, balance_after, actor, op_id, created_at)
  values (p_user, p_kind, v_delta, v_balance, p_actor, p_op, v_now);
  return jsonb_build_object('ok', true, 'balance', v_balance, 'replay', false);
end $$;

create function public.room_card_topup(p_actor text, p_user uuid, p_cards integer, p_op uuid, p_now timestamptz default null)
returns jsonb language sql set search_path = public
as $$ select room_card_adjust('topup', p_actor, p_user, p_cards, p_op, p_now) $$;

create function public.room_card_reclaim(p_actor text, p_user uuid, p_cards integer, p_op uuid, p_now timestamptz default null)
returns jsonb language sql set search_path = public
as $$ select room_card_adjust('reclaim', p_actor, p_user, p_cards, p_op, p_now) $$;

-- 暫停／恢復：已經是那個狀態就不動（不寫暫停紀錄），但操作編號照樣記在 room_card_ops；
-- 同一個操作編號重送不改狀態、回目前的狀態（replay），所以舊的請求晚到不會推翻之後的決定
create function public.room_card_set_suspended(p_actor text, p_user uuid, p_suspend boolean, p_op uuid, p_now timestamptz default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_prev room_card_ops%rowtype;
  v_kind text := case when p_suspend then 'suspend' else 'resume' end;
  v_at timestamptz;
begin
  if p_user is null or p_op is null or p_suspend is null then
    raise exception 'room_card_set_suspended：參數不對';
  end if;
  insert into room_card_accounts (user_id, updated_at) values (p_user, v_now) on conflict (user_id) do nothing;
  select suspended_at into v_at from room_card_accounts where user_id = p_user for update;
  insert into room_card_ops (op_id, user_id, kind, actor, created_at) values (p_op, p_user, v_kind, p_actor, v_now)
  on conflict (op_id) do nothing;
  if not found then -- 這個操作編號已經用過：同一件事是重送（不改狀態，回目前的狀態），不是同一件事回 op_conflict
    select * into v_prev from room_card_ops where op_id = p_op;
    if v_prev.user_id <> p_user or v_prev.kind <> v_kind then
      return jsonb_build_object('ok', false, 'error', 'op_conflict');
    end if;
    return jsonb_build_object('ok', true, 'suspendedAt', v_at, 'replay', true);
  end if;
  if p_suspend and v_at is null then
    update room_card_accounts set suspended_at = v_now, suspended_by = p_actor, updated_at = v_now where user_id = p_user returning suspended_at into v_at;
    insert into room_card_audit (user_id, action, actor, op_id, created_at) values (p_user, 'suspend', p_actor, p_op, v_now);
  elsif not p_suspend and v_at is not null then
    update room_card_accounts set suspended_at = null, suspended_by = null, updated_at = v_now where user_id = p_user;
    v_at := null;
    insert into room_card_audit (user_id, action, actor, op_id, created_at) values (p_user, 'resume', p_actor, p_op, v_now);
  end if;
  return jsonb_build_object('ok', true, 'suspendedAt', v_at, 'replay', false);
end $$;

-- 後台玩家名單用：每個有帳戶的人＋上次充值、上次扣卡、正在打的房（麻將或十三支，playing 的那一間）
create function public.room_card_players()
returns table (user_id uuid, balance integer, suspended_at timestamptz, last_topup_at timestamptz, last_charge_at timestamptz,
  playing_game text, playing_code text)
language sql
stable
set search_path = public
as $$
  select a.user_id, a.balance, a.suspended_at,
    (select max(l.created_at) from room_card_ledger l where l.user_id = a.user_id and l.kind = 'topup'),
    (select max(l.created_at) from room_card_ledger l where l.user_id = a.user_id and l.kind = 'charge'),
    p.game, p.code
  from room_card_accounts a
  left join lateral (
    select 'mahjong'::text as game, r.code from mj_players mp join mj_rooms r on r.id = mp.room_id
      where mp.user_id = a.user_id and r.status = 'playing'
    union all
    select 'thirteen'::text, r.code from th_players tp join th_rooms r on r.id = tp.room_id
      where tp.user_id = a.user_id and r.status = 'playing'
    limit 1
  ) p on true
$$;

create function public.room_card_charged_since(p_since timestamptz)
returns integer
language sql
stable
set search_path = public
as $$ select coalesce(-sum(delta), 0)::integer from room_card_ledger where kind = 'charge' and created_at >= p_since $$;

revoke all on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) from public, anon, authenticated;
revoke all on function public.room_card_adjust(text, text, uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.room_card_topup(text, uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.room_card_reclaim(text, uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.room_card_set_suspended(text, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.room_card_players() from public, anon, authenticated;
revoke all on function public.room_card_charged_since(timestamptz) from public, anon, authenticated;
grant all on table public.room_card_accounts, public.room_card_ledger, public.room_card_audit, public.room_card_ops to service_role;
grant usage on sequence public.room_card_ledger_id_seq, public.room_card_audit_id_seq to service_role;
grant execute on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz),
  public.room_card_adjust(text, text, uuid, integer, uuid, timestamptz),
  public.room_card_topup(text, uuid, integer, uuid, timestamptz), public.room_card_reclaim(text, uuid, integer, uuid, timestamptz),
  public.room_card_set_suspended(text, uuid, boolean, uuid, timestamptz), public.room_card_players(),
  public.room_card_charged_since(timestamptz) to service_role;

comment on function public.room_card_charge(text, text, text, integer, uuid[], timestamptz) is 'room_cards:20261120';

commit;

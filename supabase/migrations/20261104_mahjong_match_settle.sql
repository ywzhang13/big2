-- 斗內改成「以場結清」＋特效一次全開（老闆 2026-11-02；老柯〈斗內以場結清-資料評估與規格-2026-11-02〉、小宜規格 E 段）
--
-- 規則：
--   ・一場＝一間房（room_id；房號會重複使用，不能用房號）。一場應給＝這場 11/1 00:00（台灣時間）之後的自摸次數 × NT$10
--   ・欠款（斗內卡的 count）＝11/1 00:00 之後、所在場次還沒有有效結清的自摸次數。還在打的場次也算（玩家看到的時間點和現在一樣）
--   ・只有老闆能結清，而且只能結清已經打完的場次（match_records 有這場）
--   ・結清時後台送出實收金額（預設帶入應給）：實收 ≥ 應給才接受，多出來的算打賞，和應給一起記成同一筆斗內（斗內榜照常計入）；
--     實收 < 應給就拒絕，回傳還差多少。一次結清多場：應給是這幾場的合計，打賞只記一次（同一筆斗內）
--   ・撤回：以「那一筆斗內」為單位，同一批結清的場次全部回到未結清，那筆斗內（含打賞）整筆作廢
--   ・結清後玩家的「看過次數」降到不超過新的次數（卡片不會因為次數變少而自己跳出來）；撤回不動看過次數
--   ・「記一筆」改成純打賞（mj_donation_tip），不結清任何場次；舊的 mj_donation_record 保留不刪（部署空檔裡舊程式照樣能呼叫）
--   ・特效：有任何一筆還有效的開通，6 種都能用；開通可以不指定「目前套用」（不改玩家的選擇）
--
-- 只新增、不改舊資料：
--   ① 新表 mj_match_settlements（防刪；只准從有效改成撤回一次）
--   ② mj_fx_audit 的 action 多允許 'match_settle'、'match_unsettle'（只放寬檢查）
--   ③ 改寫函式：mj_donate_count（欠款算法）、mj_donation_void（結清用的斗內不能單獨作廢）、mj_fx_select、mj_zimo_fx_for、mj_fx_grant；舊版本體在回滾檔
--   ④ 新函式：mj_match_unsettled、mj_match_settled、mj_match_settle、mj_match_unsettle、mj_donation_tip、mj_match_zimo
--   ⑤ 11/1 之後已經用舊的「記一筆」抵扣過的帳（含之後作廢的：舊制度作廢不還原次數），補上結清列，連到原本那筆斗內（不多記斗內、不改任何舊列）。
--      每一筆舊抵扣都要剛好涵蓋那個人當時所有已打完、還沒結清的場次，對不上就整份拒絕
-- 權限：新表、新函式只給 service_role。回滾見 20261104_mahjong_match_settle_rollback.sql。
begin;

do $$
begin
  if to_regprocedure('public.mj_donation_record(text,text,text,text,integer,timestamp with time zone,text,timestamp with time zone)') is null then
    raise exception '拒絕套用：請先套用 20261102_mahjong_donate_deduct.sql';
  end if;
  if to_regclass('public.match_records') is null then
    raise exception '拒絕套用：沒有 match_records（請先套用 20261016_match_records.sql）';
  end if;
  if to_regclass('public.mj_match_settlements') is not null then
    raise exception '拒絕套用：mj_match_settlements 已經存在（已經套用過？）';
  end if;
end $$;

-- ① 結清表
create table public.mj_match_settlements (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,               -- 哪一場（= match_records.room_id）
  user_id uuid not null,               -- 誰的
  zimo_count int not null check (zimo_count > 0),  -- 結清當下這場 11/1 之後的自摸次數
  due int not null check (due = zimo_count * 10),  -- 這場應給
  donation_id uuid not null references public.mj_donations (id),  -- 同一批結清共用一筆斗內（實收＝應給合計＋打賞）
  source text not null check (source in ('settle', 'migrate')),  -- migrate＝套用這份時從舊的抵扣轉過來
  settled_by text not null,
  settled_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 200),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index mj_match_settlements_active on public.mj_match_settlements (room_id, user_id) where revoked_at is null;
create index mj_match_settlements_user on public.mj_match_settlements (user_id, settled_at desc);
create index mj_match_settlements_donation on public.mj_match_settlements (donation_id);
comment on table public.mj_match_settlements is 'mj_match_settle:20261104';

create function public.mj_match_settle_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('mj.allow_purge', true), '') = 'on' then return old; end if;
    raise exception 'mj_match_settlements：結清紀錄不能刪除';
  end if;
  if old.revoked_at is not null or new.revoked_at is null
     or (to_jsonb(new) - array['revoked_at', 'revoked_by', 'revoke_reason']) <> (to_jsonb(old) - array['revoked_at', 'revoked_by', 'revoke_reason']) then
    raise exception 'mj_match_settlements：只能把有效的結清撤回一次，不能改其他欄位';
  end if;
  return new;
end $$;
create trigger mj_match_settlements_guard before update or delete on public.mj_match_settlements
  for each row execute function public.mj_match_settle_guard();

-- ② 操作紀錄多兩種 action
alter table public.mj_fx_audit drop constraint if exists mj_fx_audit_action_check;
alter table public.mj_fx_audit add constraint mj_fx_audit_action_check
  check (action in ('donation_add', 'donation_void', 'fx_grant', 'fx_revoke', 'fx_select', 'zimo_clear', 'zimo_reset_all', 'match_settle', 'match_unsettle'));

-- ③ 欠款：11/1 00:00 之後、所在場次沒有有效結清的自摸次數
create or replace function public.mj_donate_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from mj_zimo_wins w
  where w.user_id = p_user_id and w.won_at > '2026-11-01T00:00:00+08:00'::timestamptz
    and not exists (select 1 from mj_match_settlements s where s.room_id = w.room_id and s.user_id = w.user_id and s.revoked_at is null)
$$;

-- ④ 未結清的場次（p_user 為 null＝所有人）。ended_at 為 null＝還在打（後台不能結清）
create function public.mj_match_unsettled(p_user uuid default null)
returns table (user_id uuid, room_id uuid, room_code text, started_at timestamptz, ended_at timestamptz, zimo int, due int)
language sql
stable
set search_path = public
as $$
  select w.user_id, w.room_id, m.room_code::text, m.started_at, m.ended_at, count(*)::int, count(*)::int * 10
  from mj_zimo_wins w
  left join match_records m on m.game = 'mahjong' and m.room_id = w.room_id
  where w.won_at > '2026-11-01T00:00:00+08:00'::timestamptz and (p_user is null or w.user_id = p_user)
    and not exists (select 1 from mj_match_settlements s where s.room_id = w.room_id and s.user_id = w.user_id and s.revoked_at is null)
  group by w.user_id, w.room_id, m.room_code, m.started_at, m.ended_at
$$;

-- 已結清的場次（有效的），p_since 之後結清的；batch＝那筆斗內的 id（撤回用），amount／tip＝那筆斗內的實收和打賞
create function public.mj_match_settled(p_user uuid, p_since timestamptz)
returns table (settlement_id uuid, room_id uuid, room_code text, ended_at timestamptz, zimo int, due int, donation_id uuid, amount int, tip int, settled_at timestamptz, source text)
language sql
stable
set search_path = public
as $$
  select s.id, s.room_id, m.room_code::text, m.ended_at, s.zimo_count, s.due, s.donation_id, d.amount,
         d.amount - (select sum(x.due)::int from mj_match_settlements x where x.donation_id = s.donation_id and x.revoked_at is null),
         s.settled_at, s.source
  from mj_match_settlements s
  join mj_donations d on d.id = s.donation_id
  left join match_records m on m.game = 'mahjong' and m.room_id = s.room_id
  where s.user_id = p_user and s.revoked_at is null and s.settled_at >= p_since
  order by s.settled_at desc, m.ended_at desc
$$;

-- 結清（老闆在後台按「已收」）。p_amount 為 null＝實收等於應給。成功回傳
--   { donationId, due, amount, tip, rooms: [{ roomId, roomCode, zimo, due }] }；
-- 不合格回傳 { error, ... }，什麼都不寫：no_rooms、duplicate_room、not_finished（還在打）、already_settled、nothing_due（這場沒有 11/1 後的自摸）、
--   bad_amount、short（實收不夠；附 due、amount、shortBy）
create function public.mj_match_settle(
  p_actor text, p_user text, p_name text, p_avatar text, p_rooms uuid[], p_amount int default null, p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_user uuid := p_user::uuid;
  v_due int;
  v_amount int;
  v_rooms jsonb;
  v_codes text;
  v_id uuid;
  r record;
begin
  if p_rooms is null or cardinality(p_rooms) = 0 then return jsonb_build_object('error', 'no_rooms'); end if;
  if cardinality(p_rooms) <> (select count(distinct x) from unnest(p_rooms) x) then return jsonb_build_object('error', 'duplicate_room'); end if;
  -- 同一個人同時只有一個結清在跑（重複按、兩個分頁）：鎖住這個人
  perform pg_advisory_xact_lock(hashtext('mj_match_settle:' || p_user));

  for r in
    select x.room_id, u.ended_at, u.zimo
    from unnest(p_rooms) as x(room_id) left join public.mj_match_unsettled(v_user) u on u.room_id = x.room_id
  loop
    if r.zimo is null then
      if exists (select 1 from mj_match_settlements s where s.room_id = r.room_id and s.user_id = v_user and s.revoked_at is null) then
        return jsonb_build_object('error', 'already_settled', 'roomId', r.room_id);
      end if;
      return jsonb_build_object('error', 'nothing_due', 'roomId', r.room_id);
    end if;
    if r.ended_at is null then
      return jsonb_build_object('error', 'not_finished', 'roomId', r.room_id);
    end if;
  end loop;
  select sum(u.due)::int, jsonb_agg(jsonb_build_object('roomId', u.room_id, 'roomCode', u.room_code, 'zimo', u.zimo, 'due', u.due) order by u.ended_at),
         string_agg('房 ' || u.room_code, '、' order by u.ended_at)
    into v_due, v_rooms, v_codes
  from public.mj_match_unsettled(v_user) u where u.room_id = any (p_rooms);

  v_amount := coalesce(p_amount, v_due);
  if v_amount < 1 or v_amount > 999999 then return jsonb_build_object('error', 'bad_amount'); end if;
  if v_amount < v_due then
    return jsonb_build_object('error', 'short', 'due', v_due, 'amount', v_amount, 'shortBy', v_due - v_amount);
  end if;

  insert into mj_donations (user_id, player_name, player_avatar, amount, donated_at, note, created_by, created_at)
  values (p_user, p_name, p_avatar, v_amount, v_now, left('結清 ' || v_codes, 200), p_actor, v_now)
  returning id into v_id;
  insert into mj_match_settlements (room_id, user_id, zimo_count, due, donation_id, source, settled_by, settled_at)
  select (e ->> 'roomId')::uuid, v_user, (e ->> 'zimo')::int, (e ->> 'due')::int, v_id, 'settle', p_actor, v_now
  from jsonb_array_elements(v_rooms) e;
  -- 看過次數降到不超過新的次數（規格 E 段）
  update mj_donate_acks a set seen_count = least(a.seen_count, public.mj_donate_count(v_user)) where a.user_id = v_user;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'match_settle', p_user, v_id,
          jsonb_build_object('rooms', v_rooms, 'due', v_due, 'amount', v_amount, 'tip', v_amount - v_due, 'price', 10));
  return jsonb_build_object('donationId', v_id, 'due', v_due, 'amount', v_amount, 'tip', v_amount - v_due, 'rooms', v_rooms);
end $$;

-- 撤回一批結清（p_donation＝那筆斗內的 id）：這批有效的結清全部撤回、那筆斗內整筆作廢。
-- 成功回傳 { donationId, amount, rooms: [{ roomId, roomCode, zimo, due }] }；沒有有效的結清回傳 { error: 'not_found' }，什麼都不寫
create function public.mj_match_unsettle(p_actor text, p_donation uuid, p_reason text, p_now timestamptz default null) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_user uuid;
  v_rooms jsonb;
  v_amount int;
begin
  select s.user_id into v_user from mj_match_settlements s where s.donation_id = p_donation and s.revoked_at is null limit 1;
  if v_user is null then return jsonb_build_object('error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('mj_match_settle:' || v_user::text));
  with done as (
    update mj_match_settlements s set revoked_at = v_now, revoked_by = p_actor, revoke_reason = left(p_reason, 200)
    where s.donation_id = p_donation and s.revoked_at is null
    returning s.room_id, s.zimo_count, s.due
  )
  select jsonb_agg(jsonb_build_object('roomId', d.room_id, 'roomCode', m.room_code, 'zimo', d.zimo_count, 'due', d.due) order by m.ended_at)
    into v_rooms from done d left join match_records m on m.game = 'mahjong' and m.room_id = d.room_id;
  if v_rooms is null then return jsonb_build_object('error', 'not_found'); end if;
  update mj_donations set voided_at = v_now, voided_by = p_actor, void_reason = left('撤回結清：' || coalesce(p_reason, ''), 200)
  where id = p_donation and voided_at is null
  returning amount into v_amount;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'match_unsettle', v_user::text, p_donation,
          jsonb_build_object('rooms', v_rooms, 'amount', v_amount, 'donation_voided', v_amount is not null, 'reason', p_reason));
  return jsonb_build_object('donationId', p_donation, 'amount', v_amount, 'rooms', v_rooms);
end $$;

-- 通用作廢：結清用的那筆斗內不能從這裡作廢（審伯 2026-11-02 必修 1），只能用 mj_match_unsettle 整批撤回，
-- 否則場次還是已結清、欠款不回來，斗內榜卻扣掉了。被擋下回 false，什麼都不寫（路由回 409 not_voidable）
create or replace function public.mj_donation_void(p_actor text, p_id uuid, p_reason text, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_row mj_donations%rowtype;
begin
  if exists (select 1 from mj_match_settlements s where s.donation_id = p_id and s.revoked_at is null) then
    return false;
  end if;
  update mj_donations set voided_at = v_now, voided_by = p_actor, void_reason = p_reason
  where id = p_id and voided_at is null
  returning * into v_row;
  if not found then return false; end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_void', v_row.user_id, p_id, jsonb_build_object('amount', v_row.amount, 'reason', p_reason));
  return true;
end $$;

-- 記一筆打賞：只記錢（連同操作紀錄），不結清任何場次。回傳新紀錄 id
create function public.mj_donation_tip(
  p_actor text, p_user text, p_name text, p_avatar text, p_amount int, p_donated_at timestamptz, p_note text, p_now timestamptz default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_id uuid;
begin
  insert into mj_donations (user_id, player_name, player_avatar, amount, donated_at, note, created_by, created_at)
  values (p_user, p_name, p_avatar, p_amount, p_donated_at, coalesce(p_note, ''), p_actor, v_now)
  returning id into v_id;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
  values (v_now, p_actor, 'donation_add', p_user, v_id,
          jsonb_build_object('amount', p_amount, 'donated_at', p_donated_at, 'note', coalesce(p_note, ''), 'tip', p_amount, 'settle', false));
  return v_id;
end $$;

-- 對戰紀錄：這幾場每一把是誰自摸（只有 LINE 帳號有紀錄；遊客的自摸不記）
create function public.mj_match_zimo(p_rooms uuid[])
returns table (room_id uuid, hand_no int, user_id uuid, won_at timestamptz)
language sql
stable
set search_path = public
as $$
  select w.room_id, w.hand_no, w.user_id, w.won_at from mj_zimo_wins w where w.room_id = any (p_rooms) order by w.room_id, w.hand_no
$$;

-- 特效：有任何一筆還有效的開通，6 種都能用
create or replace function public.mj_fx_select(p_user text, p_fx text, p_permanent boolean, p_now timestamptz default null) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_fx <> 'golden' and not p_permanent and not exists (
    select 1 from mj_fx_grants where user_id = p_user and revoked_at is null and expires_at > v_now
  ) then
    return false;
  end if;
  insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_fx, v_now)
  on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_user, 'fx_select', p_user, jsonb_build_object('fx', p_fx));
  return true;
end $$;

create or replace function public.mj_zimo_fx_for(p_users text[], p_now timestamptz default null)
returns table (user_id text, fx text, until timestamptz)
language sql
stable
set search_path = public
as $$
  select p.user_id, p.fx,
    case when p.fx = 'golden' then null else (
      select max(g.expires_at) from mj_fx_grants g
        where g.user_id = p.user_id and g.revoked_at is null and g.expires_at > coalesce(p_now, now())
    ) end
  from mj_fx_prefs p where p.user_id = any (p_users);
$$;

-- 開通：p_active 可以是 null（不改玩家目前的選擇，例如延長）；有給就要在開通的清單裡
create or replace function public.mj_fx_grant(p_actor text, p_user text, p_fx text[], p_active text, p_expires timestamptz, p_now timestamptz default null) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n int;
begin
  if p_active is not null and not (p_active = any (p_fx)) then
    raise exception 'mj_fx_grant：目前套用的特效要在開通的清單裡';
  end if;
  if p_expires <= v_now then
    raise exception 'mj_fx_grant：到期時間要在現在之後';
  end if;
  insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
  select p_user, f, p_actor, v_now, p_expires from (select distinct unnest(p_fx) as f) x;
  get diagnostics v_n = row_count;
  if p_active is not null then
    insert into mj_fx_prefs (user_id, fx, updated_at) values (p_user, p_active, v_now)
    on conflict (user_id) do update set fx = excluded.fx, updated_at = excluded.updated_at;
  end if;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_grant', p_user, jsonb_build_object('fx', to_jsonb(p_fx), 'active', p_active, 'expires_at', p_expires));
  return v_n;
end $$;

-- ⑤ 11/1 之後用舊的「記一筆」抵扣過的帳 → 補結清列（連到原本那筆斗內）
do $$
declare
  v_cut constant timestamptz := '2026-11-01T00:00:00+08:00';
  d record;
  v_rooms int;
  v_zimo int;
begin
  for d in
    select x.id, x.user_id, x.created_at, (a.detail ->> 'deducted')::int as deducted
    from mj_donations x join mj_fx_audit a on a.record_id = x.id and a.action = 'donation_add'
    -- 已作廢的也要轉：舊制度作廢不會還原已抵扣的次數（審伯 2026-11-02 必修 2），所以那幾場照樣算已結清
    where x.created_at > v_cut and coalesce((a.detail ->> 'deducted')::int, 0) > 0
    order by x.created_at
  loop
    -- 那個人在記帳當下所有已打完、還沒結清、有 11/1 後自摸的場次
    create temp table _m on commit drop as
      select u.room_id, u.zimo, u.due from public.mj_match_unsettled(d.user_id::uuid) u where u.ended_at is not null and u.ended_at <= d.created_at;
    select count(*), coalesce(sum(zimo), 0) into v_rooms, v_zimo from _m;
    if v_zimo <> d.deducted then
      raise exception '拒絕套用：斗內 % 抵扣了 % 次，但當時已打完的未結清場次共 % 次，對不上', d.id, d.deducted, v_zimo;
    end if;
    if exists (select 1 from mj_zimo_wins w join _m on _m.room_id = w.room_id where w.user_id = d.user_id::uuid and w.won_at > d.created_at) then
      raise exception '拒絕套用：斗內 % 之後同一場還有自摸，無法整場結清', d.id;
    end if;
    insert into mj_match_settlements (room_id, user_id, zimo_count, due, donation_id, source, settled_by, settled_at)
    select _m.room_id, d.user_id::uuid, _m.zimo, _m.due, d.id, 'migrate', 'system', d.created_at from _m;
    insert into mj_fx_audit (at, actor_id, action, target_user_id, record_id, detail)
    values (now(), 'system', 'match_settle', d.user_id, d.id,
            jsonb_build_object('migrate', true, 'rooms', (select jsonb_agg(jsonb_build_object('roomId', room_id, 'zimo', zimo, 'due', due)) from _m),
                               'due', v_zimo * 10, 'reason', '以場結清上線：11/1 之後已用舊的記一筆抵扣過的帳，補上結清（不多記斗內）'));
    drop table _m;
  end loop;
end $$;

-- 權限
do $$
declare
  f text;
begin
  alter table public.mj_match_settlements enable row level security;
  revoke all on table public.mj_match_settlements from public, anon, authenticated, service_role;
  grant select, insert, update on table public.mj_match_settlements to service_role;
  foreach f in array array[
    'public.mj_match_settle_guard()',
    'public.mj_donate_count(uuid)',
    'public.mj_match_unsettled(uuid)',
    'public.mj_match_settled(uuid, timestamptz)',
    'public.mj_match_settle(text, text, text, text, uuid[], int, timestamptz)',
    'public.mj_match_unsettle(text, uuid, text, timestamptz)',
    'public.mj_donation_tip(text, text, text, text, int, timestamptz, text, timestamptz)',
    'public.mj_donation_void(text, uuid, text, timestamptz)',
    'public.mj_match_zimo(uuid[])',
    'public.mj_fx_select(text, text, boolean, timestamptz)',
    'public.mj_zimo_fx_for(text[], timestamptz)',
    'public.mj_fx_grant(text, text, text[], text, timestamptz, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 自我檢查：公開金鑰對新表、新函式都沒有權限；防刪改觸發器在
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_match_settlements', p) then
        raise exception '結清表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
    if has_function_privilege(r, 'public.mj_match_settle(text, text, text, text, uuid[], int, timestamptz)', 'execute')
       or has_function_privilege(r, 'public.mj_match_unsettle(text, uuid, text, timestamptz)', 'execute') then
      raise exception '結清函式鎖權限沒有完成：% 還能執行，整份不生效', r;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'mj_match_settlements_guard' and not tgisinternal) then
    raise exception '結清表的防刪改觸發器沒有建好，整份不生效';
  end if;
end $$;

commit;

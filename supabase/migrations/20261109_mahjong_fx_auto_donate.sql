-- 有斗內就自動開通自摸特效（老闆 2026-11-09；阿哲〈斗內自動開通特效-規則確認〉4 題拍板＋老闆帳號排除）
--
-- 規則：
--   ・玩家有任何一筆沒作廢、金額至少 1 元的斗內（mj_donations 未作廢列，打賞、結清都算），且目前沒有任何有效開通，
--     就自動開通全部 6 種、永久，不改玩家目前選用的特效（和後台手動開通一樣）
--   ・玩家的有效斗內全部作廢（or 結清全部撤回）時，收回「系統自動開的」那幾列（granted_by = 'system:donate'）；
--     老闆手動開的（granted_by 是老闆帳號 id）不收回
--   ・老闆手動收回過特效的人，之後再斗內不會自動開通，除非老闆自己又手動開通一次（mj_fx_auto_block 有列＝擋著）
--   ・系統自動收回不算「老闆親手收回」，不會擋下之後的自動開通（不寫進 mj_fx_auto_block）
--   ・老闆帳號（lib/mahjong/zimoFx/rules.ts 的 OWNER_USER_ID）一律跳過，不受影響
--   ・每次自動開通／收回都寫進 mj_fx_audit（actor_id='system'，detail.auto=true），後台操作紀錄看得到
--
-- 只新增、不改舊資料：
--   ① 新表 mj_fx_auto_block（老闆手動收回過、還沒被老闆重新開通的帳號；不是帳目紀錄，不用防刪觸發器）
--   ② 新函式 mj_fx_auto_sync（核心邏輯，同一個交易裡呼叫）
--   ③ 改寫 mj_fx_grant（手動開通時解除擋）、mj_fx_revoke（手動收回時設擋）──舊版本體在回滾檔
--   ④ 改寫 mj_donation_tip、mj_match_settle、mj_donation_void、mj_match_unsettle，在同一個交易裡呼叫 mj_fx_auto_sync──舊版本體在回滾檔
--      （不動 mj_donation_add／mj_donation_record：10/31 以場結清上線後現在的路由都不呼叫了，只留給部署空檔相容）
--   ⑤ 一次性回填 mj_fx_auto_block：每個帳號最後一次「老闆手動」fx_grant／fx_revoke 若是 fx_revoke，就算被擋著
--      （這份只回填「擋著」的狀態，不補開任何特效；補開舊斗內者是獨立、要明確下 --apply 才寫入的步驟，
--      見 scripts/mj-fx-auto-donate-backfill.ts，規則呼叫這份的 mj_fx_auto_sync，和即時自動開通同一條規則，
--      這份 migration 本身完全不自動補開——阿哲 2026-11-09 拍板：補開要先給老闆看過名單再執行，不能跟著部署自動跑）
-- 併發：mj_fx_auto_sync 一開頭就取得以玩家 id 為 key 的交易內鎖（審伯 2026-11-09 必修②），
--   同一玩家的打賞／結清／作廢／撤回結清／補開同時觸發會依序處理，不會重複開通或漏收回。
-- API 介面完全沒變（這幾支函式的參數、回傳格式都和套用前一樣），不用通知前端。
-- 權限：新表、新函式只給 service_role。回滾見 20261109_mahjong_fx_auto_donate_rollback.sql。
begin;

do $$
begin
  if to_regprocedure('public.mj_match_settle(text,text,text,text,uuid[],integer,timestamp with time zone)') is null then
    raise exception '拒絕套用：請先套用 20261104_mahjong_match_settle.sql';
  end if;
  if to_regclass('public.mj_fx_auto_block') is not null then
    raise exception '拒絕套用：mj_fx_auto_block 已經存在（已經套用過？）';
  end if;
end $$;

-- ① 老闆手動收回過、還沒重新開通的帳號
create table public.mj_fx_auto_block (
  user_id uuid primary key,
  blocked_at timestamptz not null
);
comment on table public.mj_fx_auto_block is 'mj_fx_auto_block:20261109';
alter table public.mj_fx_auto_block enable row level security;
revoke all on table public.mj_fx_auto_block from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.mj_fx_auto_block to service_role;

-- ② 核心：由 mj_donation_tip／mj_match_settle／mj_donation_void／mj_match_unsettle 在同一個交易裡呼叫
create function public.mj_fx_auto_sync(p_user text, p_now timestamptz default null) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_has boolean;
  v_blocked boolean;
  v_active boolean;
  v_n int;
  v_fx constant text[] := array['meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura'];
begin
  if p_user = 'c5707922-f6f0-4c10-9c87-3532fdbf6b72' then -- 老闆帳號（OWNER_USER_ID）不受影響
    return '{}'::jsonb;
  end if;
  -- 鎖住這個玩家：打賞／結清／作廢／撤回結清／補開同時觸發也會依序處理，後面的會看到前面已經提交的結果再判斷，
  -- 不會兩邊都讀到舊狀態而重複開通、或兩邊都以為對方還有效斗內而漏收回
  perform pg_advisory_xact_lock(hashtext('mj_fx_auto_sync:' || p_user));
  v_has := exists (select 1 from mj_donations where user_id = p_user and voided_at is null);
  v_active := exists (select 1 from mj_fx_grants where user_id = p_user and revoked_at is null and expires_at > v_now);
  if v_has and not v_active then
    v_blocked := exists (select 1 from mj_fx_auto_block where user_id = p_user::uuid);
    if not v_blocked then
      insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
      select p_user, f, 'system:donate', v_now, 'infinity'::timestamptz from unnest(v_fx) f;
      insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
      values (v_now, 'system', 'fx_grant', p_user, jsonb_build_object('fx', to_jsonb(v_fx), 'active', null, 'expires_at', 'infinity', 'auto', true, 'reason', 'donate'));
      return jsonb_build_object('granted', true);
    end if;
  elsif not v_has and v_active then
    update mj_fx_grants set revoked_at = v_now, revoked_by = 'system'
    where user_id = p_user and revoked_at is null and granted_by = 'system:donate';
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
      values (v_now, 'system', 'fx_revoke', p_user, jsonb_build_object('fx', 'all', 'revoked', v_n, 'auto', true, 'reason', 'donations_cleared'));
      return jsonb_build_object('revoked', true);
    end if;
  end if;
  return '{}'::jsonb;
end $$;

-- ③ 手動開通：解除擋；手動收回：設擋（老闆 2026-11-09）
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
  delete from mj_fx_auto_block where user_id = p_user::uuid;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_grant', p_user, jsonb_build_object('fx', to_jsonb(p_fx), 'active', p_active, 'expires_at', p_expires));
  return v_n;
end $$;

create or replace function public.mj_fx_revoke(p_actor text, p_user text, p_fx text[], p_now timestamptz default null) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n int;
begin
  update mj_fx_grants set revoked_at = v_now, revoked_by = p_actor
  where user_id = p_user and revoked_at is null and expires_at > v_now and (p_fx is null or fx = any (p_fx));
  get diagnostics v_n = row_count;
  insert into mj_fx_auto_block (user_id, blocked_at) values (p_user::uuid, v_now)
    on conflict (user_id) do update set blocked_at = excluded.blocked_at;
  insert into mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (v_now, p_actor, 'fx_revoke', p_user, jsonb_build_object('fx', coalesce(to_jsonb(p_fx), '"all"'::jsonb), 'revoked', v_n));
  return v_n;
end $$;

-- ④ 記一筆打賞、結清、作廢、撤回結清之後，同一個交易裡同步開通／收回
create or replace function public.mj_donation_tip(
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
  perform public.mj_fx_auto_sync(p_user, v_now);
  return v_id;
end $$;

create or replace function public.mj_match_settle(
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
  perform public.mj_fx_auto_sync(p_user, v_now);
  return jsonb_build_object('donationId', v_id, 'due', v_due, 'amount', v_amount, 'tip', v_amount - v_due, 'rooms', v_rooms);
end $$;

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
  perform public.mj_fx_auto_sync(v_row.user_id, v_now);
  return true;
end $$;

create or replace function public.mj_match_unsettle(p_actor text, p_donation uuid, p_reason text, p_now timestamptz default null) returns jsonb
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
  perform public.mj_fx_auto_sync(v_user::text, v_now);
  return jsonb_build_object('donationId', p_donation, 'amount', v_amount, 'rooms', v_rooms);
end $$;

-- ⑤ 回填：每個帳號最後一次「老闆手動」fx_grant／fx_revoke，若是 fx_revoke 就算被擋著（和上線試算同一條規則）
insert into public.mj_fx_auto_block (user_id, blocked_at)
select a.target_user_id::uuid, a.at from (
  select target_user_id, action, at,
         row_number() over (partition by target_user_id order by at desc, id desc) as rn
  from public.mj_fx_audit
  where action in ('fx_grant', 'fx_revoke') and actor_id <> 'system'
) a
where a.rn = 1 and a.action = 'fx_revoke'
on conflict (user_id) do nothing;

-- 權限
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mj_fx_auto_sync(text, timestamptz)',
    'public.mj_fx_grant(text, text, text[], text, timestamptz, timestamptz)',
    'public.mj_fx_revoke(text, text, text[], timestamptz)',
    'public.mj_donation_tip(text, text, text, text, int, timestamptz, text, timestamptz)',
    'public.mj_match_settle(text, text, text, text, uuid[], int, timestamptz)',
    'public.mj_donation_void(text, uuid, text, timestamptz)',
    'public.mj_match_unsettle(text, uuid, text, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 自我檢查：公開金鑰對新表、新函式都沒有權限
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_fx_auto_block', p) then
        raise exception '自動擋表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
    if has_function_privilege(r, 'public.mj_fx_auto_sync(text, timestamptz)', 'execute') then
      raise exception '自動開通／收回函式鎖權限沒有完成：% 還能執行，整份不生效', r;
    end if;
  end loop;
end $$;

commit;

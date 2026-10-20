-- 麻將遊戲內互動特效（愛心、砸錢、丟雞蛋、潑水桶、拳擊）的伺服器冷卻（2026-10-21）
--
-- 規則（數字由伺服器傳入，見 lib/mahjong/effects/rules.ts）：
--   ・發送冷卻分兩組共用：輕組（愛心、砸錢）一組、重組（雞蛋、潑水、拳擊）一組，兩組互不影響
--   ・重組另有「接收保護」：同一個目標被任何人用重組打中後，保護期內任何人都不能再用重組打他（輕組不受影響）
--   ・被擋下的請求不扣發送者的冷卻、也不刷新目標的保護期
--
-- 新增：
--   ① mj_effect_rate：每房每人每個「位子」最後一次的時間（只存時間，不存內容）
--        slot = 'send_light'（輕組發送冷卻）／'send_heavy'（重組發送冷卻）／'recv_heavy'（重組接收保護）
--   ② mj_effect_take()：在同一個交易裡鎖住發送者和目標的列、判斷、記下這次；
--        多台伺服器同時收到（例如三家同時用重組打同一人）只會放行一個
-- 特效本身不入庫：伺服器確認後直接廣播給同桌四人。房間關閉時伺服器刪掉這房的列；一天沒動的列由函式順手清掉。
--
-- 權限：表和函式只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   最後的自我檢查不成立就丟錯，整份不生效。只新增、不改現有資料表；回滾見 20261021_mahjong_effects_rollback.sql。
--
-- 既有同名物件：這份建立的表、函式都加上標記註解 'mj_effects:20261021'。
--   套用前如果 public 已經有同名的表、索引或函式，卻不是這份建的（沒有標記），就整份拒絕、什麼都不改，
--   避免之後回滾把別人的物件刪掉。重跑這份時看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_effects:20261021';
  v_tbl oid := to_regclass('public.mj_effect_rate');
  v_idx oid := to_regclass('public.mj_effect_rate_last_at');
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕套用：public.mj_effect_rate 已經存在，而且不是這份 migration 建的；請先確認那張表的用途';
  end if;
  if v_idx is not null and (v_tbl is null or not exists (select 1 from pg_index where indexrelid = v_idx and indrelid = v_tbl)) then
    raise exception '拒絕套用：public.mj_effect_rate_last_at 已經存在，而且不是這份 migration 建的';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mj_effect_take'
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕套用：public.mj_effect_take 已經存在，而且不是這份 migration 建的；請先確認那個函式的用途';
  end if;
end $$;

create table if not exists public.mj_effect_rate (
  room_id text not null,
  subject_id text not null, -- send_* 是發送者、recv_heavy 是被打的人（都是登入帳號 id）
  slot text not null check (slot in ('send_light', 'send_heavy', 'recv_heavy')),
  last_at timestamptz not null,
  primary key (room_id, subject_id, slot)
);
create index if not exists mj_effect_rate_last_at on public.mj_effect_rate (last_at);

-- 回傳 jsonb：允許 → {"ok":true}（已記下發送者冷卻，重組另記目標保護期）；
--   擋下 → {"ok":false,"reason":"cooldown"|"target_protected","retry_after_ms":N}，什麼都不寫。
--   發送者自己在冷卻中優先回 cooldown（等目標保護期過了他也送不出去）。
-- 互斥用交易內的 advisory lock（交易結束自動放開），不靠先寫佔位列再鎖列：
--   鎖「這房＋發送者＋組別」和（重組時）「這房＋目標＋接收保護」兩把鎖，照鎖編號由小到大取，
--   A 打 B、B 打 A 同時發生也不會互相卡死。鎖住之後才讀、判斷，通過才寫；被擋下時完全不碰這張表。
--   函式要維持 VOLATILE（預設）：裡面每個查詢都拿新的快照，拿到鎖之後才讀得到前一個請求剛寫入的時間。
-- p_protect_ms = 0 表示這組沒有接收保護（輕組）。p_now 只給測試用，正式一律用資料庫時間。
create or replace function public.mj_effect_take(
  p_room_id text,
  p_sender_id text,
  p_target_id text,
  p_group text,
  p_cooldown_ms int,
  p_protect_ms int,
  p_now timestamptz default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_send_slot text := 'send_' || p_group;
  v_protect boolean := p_protect_ms > 0;
  v_send_last timestamptz;
  v_recv_last timestamptz;
  v_wait int;
  v_key bigint;
begin
  if p_group not in ('light', 'heavy') then
    raise exception 'mj_effect_take：未知的組別 %', p_group;
  end if;
  if p_sender_id = p_target_id then
    raise exception 'mj_effect_take：發送者和目標不能是同一人';
  end if;

  -- 取鎖：鎖編號由 'mj_effect:<房>:<人>:<位子>' 算出，依編號由小到大取（固定順序，不會死結）
  foreach v_key in array (
    select array_agg(k order by k) from unnest(array[
      hashtextextended('mj_effect:' || p_room_id || ':' || p_sender_id || ':' || v_send_slot, 0),
      case when v_protect then hashtextextended('mj_effect:' || p_room_id || ':' || p_target_id || ':recv_heavy', 0) end
    ]) as k where k is not null
  ) loop
    perform pg_advisory_xact_lock(v_key);
  end loop;

  select last_at into v_send_last from mj_effect_rate
  where room_id = p_room_id and subject_id = p_sender_id and slot = v_send_slot;
  if v_protect then
    select last_at into v_recv_last from mj_effect_rate
    where room_id = p_room_id and subject_id = p_target_id and slot = 'recv_heavy';
  end if;

  if v_send_last is not null then
    v_wait := ceil(p_cooldown_ms - extract(epoch from (v_now - v_send_last)) * 1000)::int;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_ms', v_wait);
    end if;
  end if;
  if v_protect and v_recv_last is not null then
    v_wait := ceil(p_protect_ms - extract(epoch from (v_now - v_recv_last)) * 1000)::int;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'reason', 'target_protected', 'retry_after_ms', v_wait);
    end if;
  end if;

  -- 通過了才寫入（同一個交易，兩筆一起成功或一起不成功）
  insert into mj_effect_rate (room_id, subject_id, slot, last_at) values (p_room_id, p_sender_id, v_send_slot, v_now)
  on conflict (room_id, subject_id, slot) do update set last_at = excluded.last_at;
  if v_protect then
    insert into mj_effect_rate (room_id, subject_id, slot, last_at) values (p_room_id, p_target_id, 'recv_heavy', v_now)
    on conflict (room_id, subject_id, slot) do update set last_at = excluded.last_at;
  end if;
  delete from mj_effect_rate where last_at < v_now - interval '1 day';
  return jsonb_build_object('ok', true);
end $$;

comment on table public.mj_effect_rate is 'mj_effects:20261021';
comment on function public.mj_effect_take(text, text, text, text, int, int, timestamptz) is 'mj_effects:20261021';

-- 權限：只給 service_role
alter table public.mj_effect_rate enable row level security;
revoke all on table public.mj_effect_rate from public, anon, authenticated;
grant select, insert, update, delete on table public.mj_effect_rate to service_role;
revoke all on function public.mj_effect_take(text, text, text, text, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.mj_effect_take(text, text, text, text, int, int, timestamptz) to service_role;

-- 自我檢查：公開金鑰對表（任何操作）、函式都不能有權限，表上不能有 policy
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_effect_rate', p) then
        raise exception '特效冷卻表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
    if has_function_privilege(r, 'public.mj_effect_take(text, text, text, text, int, int, timestamptz)', 'execute') then
      raise exception '特效冷卻函式鎖權限沒有完成：% 還能執行，整份不生效', r;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mj_effect_rate') then
    raise exception '特效冷卻表不應該有 policy，整份不生效';
  end if;
end $$;

commit;

-- 麻將遊戲內打字聊天與語音訊息（2026-10-23）
--
-- 新增：
--   ① mj_chat_rate：每房每人每種訊息（text、voice）最近幾次的送出時間（伺服器擋發太快用，不存訊息內容）
--   ② mj_chat_take()：檢查冷卻；p_commit = true 且通過才記下這次。被擋下、或只是預先檢查（p_commit = false）時完全不寫入
--   ③ Storage 私有 bucket mj-voice：轉好的語音（m4a），只靠伺服器簽發的 1 小時網址播放；房間關閉時由伺服器刪除，
--      漏掉的由伺服器定期清除（超過 24 小時、或房間已經不在）
-- 修改：
--   ④ mj_user_prefs 的格式限制（mj_user_prefs_prefs_check）：原本只收 v2 { v, back, felt }，
--      改成 v2 或 v3 { v: 3, back, felt, autoVoice: 布林, voiceVol: 字串 }。只放寬、不改資料；值的白名單在伺服器
--      （lib/mahjong/userPrefs/rules.ts）。前提是 20261022_mahjong_prefs.sql 已經套用。
--
-- 訊息本身不入庫：伺服器確認後直接廣播給同桌四人的座位頻道。
-- 權限：表、函式只給 service_role（伺服器路由）。anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；
--   bucket 不公開，storage.objects 上也不能有任何讓公開金鑰碰得到 mj-voice 的 policy。
--   最後的自我檢查不成立就丟錯，整份不生效。回滾見 20261023_mahjong_chat_rollback.sql。
--
-- 既有同名物件：這份建立的表、函式、格式限制都加上標記註解 'mj_chat:20261023'。
--   要替換的 mj_user_prefs_prefs_check 沒有標記時，一定要和 20261022 的正式 v2 定義完全一樣才換，否則整份拒絕。
--   套用前如果已經有同名的表、主鍵索引、函式，或 mj-voice bucket，卻不是這份建的，就整份拒絕、什麼都不改；
--   bucket 沒辦法加註解，所以「冷卻表有標記」才算 bucket 是這份建的。重跑這份時看到自己的標記就照常（冪等）。
begin;

do $$
declare
  v_marker constant text := 'mj_chat:20261023';
  v_tbl oid := to_regclass('public.mj_chat_rate');
  v_pk oid := to_regclass('public.mj_chat_rate_pkey');
  v_prefs oid := to_regclass('public.mj_user_prefs');
  v_mine boolean;
  v_cmt text;
  v_def text;
  v_ref text;
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕套用：public.mj_chat_rate 已經存在，而且不是這份 migration 建的；請先確認那張表的用途';
  end if;
  v_mine := v_tbl is not null;
  if v_pk is not null and not exists (select 1 from pg_index where indexrelid = v_pk and indrelid = v_tbl) then
    raise exception '拒絕套用：public.mj_chat_rate_pkey 已經存在，而且不是這份 migration 建的';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mj_chat_take'
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕套用：public.mj_chat_take 已經存在，而且不是這份 migration 建的；請先確認那個函式的用途';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception '拒絕套用：找不到 storage.buckets／storage.objects（語音檔要存在 Supabase Storage）';
  end if;
  if exists (select 1 from storage.buckets where id = 'mj-voice') and not v_mine then
    raise exception '拒絕套用：Storage 已經有 mj-voice bucket，而且不是這份 migration 建的；請先確認那個 bucket 的用途';
  end if;
  if v_prefs is null or obj_description(v_prefs, 'pg_class') is distinct from 'mj_prefs:20261022' then
    raise exception '拒絕套用：public.mj_user_prefs 不存在或不是 20261022_mahjong_prefs.sql 建的；請先套用那份';
  end if;
  -- 格式限制：已經是這份換的（有標記）→ 照常；沒有標記 → 一定要和 20261022 的正式 v2 定義一模一樣才換，
  --   否則（被別人改過、或根本不見了）整份拒絕，不蓋掉不知道來源的限制。
  --   比對方式：在同一個資料庫用正式 v2 的寫法建一張暫存表，拿 pg_get_constraintdef 的結果逐字比（格式由同一個資料庫產生，不受版本影響）
  select obj_description(oid, 'pg_constraint'), pg_get_constraintdef(oid) into v_cmt, v_def from pg_constraint
  where conrelid = v_prefs and conname = 'mj_user_prefs_prefs_check';
  if v_cmt is distinct from v_marker then
    if v_cmt is not null then
      raise exception '拒絕套用：mj_user_prefs_prefs_check 有不認得的標記（%），不知道是誰改的', v_cmt;
    end if;
    if v_def is null then
      raise exception '拒絕套用：mj_user_prefs 沒有 mj_user_prefs_prefs_check（20261022 的格式限制不見了），請先確認';
    end if;
    create temp table mj_chat_v2_ref (prefs jsonb, constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
      prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb
      and prefs -> 'v' = '2'::jsonb and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
      and pg_column_size(prefs) <= 1024
    else false end));
    select pg_get_constraintdef(oid) into v_ref from pg_constraint where conrelid = 'pg_temp.mj_chat_v2_ref'::regclass;
    drop table pg_temp.mj_chat_v2_ref;
    if v_def is distinct from v_ref then
      raise exception '拒絕套用：mj_user_prefs_prefs_check 不是 20261022 的正式 v2 定義（可能被手動改過），不蓋掉；目前是 %', v_def;
    end if;
  end if;
end $$;

-- ① 冷卻紀錄（room_id、user_id 用 text：不綁外鍵，房間關閉時由伺服器刪掉；一天沒動的列由函式順手清掉）
create table if not exists public.mj_chat_rate (
  room_id text not null,
  user_id text not null,
  kind text not null check (kind in ('text', 'voice')),
  sent_at timestamptz[] not null, -- 最近幾次的送出時間（最多保留 burst 判斷要用的筆數）
  last_at timestamptz not null,
  primary key (room_id, user_id, kind)
);

-- ② 檢查冷卻。回傳 0＝可以送（p_commit 時已記下這次），> 0＝還要等幾毫秒（什麼都沒寫）。
--   規則參數由伺服器傳入（lib/mahjong/chat/rules.ts）：
--   最近 p_burst_count 次都在 p_burst_window_ms 內 → 冷卻 p_burst_cooldown_ms，否則 p_cooldown_ms（都從最後一次起算）。
--   語音先用 p_commit = false 預先檢查（擋洗版、不讓伺服器白跑轉檔），轉檔成功才用 p_commit = true 真的扣；
--   轉檔失敗的語音不會扣冷卻。兩次之間別的請求先扣了，第二次照樣會擋下。
--   互斥用交易內的 advisory lock（同一房同一人同一種一把鎖），鎖住之後才讀、判斷，通過才寫。
--   函式要維持 VOLATILE（預設）：拿到鎖之後的查詢才讀得到前一個請求剛寫入的時間。
--   p_now 只給測試用，正式一律用資料庫時間。
create or replace function public.mj_chat_take(
  p_room_id text,
  p_user_id text,
  p_kind text,
  p_cooldown_ms int,
  p_burst_count int,
  p_burst_window_ms int,
  p_burst_cooldown_ms int,
  p_commit boolean,
  p_now timestamptz default null
) returns int
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_times timestamptz[];
  v_n int;
  v_cd int := p_cooldown_ms;
  v_wait int;
  v_keep int := greatest(p_burst_count, 1);
begin
  if p_kind not in ('text', 'voice') then
    raise exception 'mj_chat_take：未知的訊息種類 %', p_kind;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mj_chat:' || p_room_id || ':' || p_user_id || ':' || p_kind, 0));

  select sent_at into v_times from mj_chat_rate
  where room_id = p_room_id and user_id = p_user_id and kind = p_kind;
  v_n := coalesce(array_length(v_times, 1), 0);
  if v_n > 0 then
    if p_burst_count > 1 and v_n >= p_burst_count
       and v_times[v_n] - v_times[v_n - p_burst_count + 1] <= make_interval(secs => p_burst_window_ms / 1000.0) then
      v_cd := p_burst_cooldown_ms;
    end if;
    v_wait := ceil(v_cd - extract(epoch from (v_now - v_times[v_n])) * 1000)::int;
    if v_wait > 0 then
      return v_wait;
    end if;
  end if;
  if not p_commit then
    return 0;
  end if;

  v_times := coalesce(v_times, '{}') || v_now;
  v_n := array_length(v_times, 1);
  if v_n > v_keep then
    v_times := v_times[v_n - v_keep + 1 : v_n];
  end if;
  insert into mj_chat_rate (room_id, user_id, kind, sent_at, last_at) values (p_room_id, p_user_id, p_kind, v_times, v_now)
  on conflict (room_id, user_id, kind) do update set sent_at = excluded.sent_at, last_at = excluded.last_at;
  delete from mj_chat_rate where last_at < v_now - interval '1 day';
  return 0;
end $$;

comment on table public.mj_chat_rate is 'mj_chat:20261023';
comment on function public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz) is 'mj_chat:20261023';

alter table public.mj_chat_rate enable row level security;
revoke all on table public.mj_chat_rate from public, anon, authenticated;
grant select, insert, update, delete on table public.mj_chat_rate to service_role;
revoke all on function public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz) to service_role;

-- ③ 語音 bucket：私有、只收 audio/mp4、單檔 256KB（轉好的 10 秒 m4a 約 60KB）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mj-voice', 'mj-voice', false, 262144, array['audio/mp4'])
on conflict (id) do update set public = false, file_size_limit = 262144, allowed_mime_types = array['audio/mp4'];

-- ④ 偏好設定格式：v2 或 v3（v3 多了語音的自動播放、音量）。資料不動，只換限制
alter table public.mj_user_prefs drop constraint if exists mj_user_prefs_prefs_check;
alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
  pg_column_size(prefs) <= 1024
  and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
  and (
    (prefs -> 'v' = '2'::jsonb and prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb)
    or (prefs -> 'v' = '3'::jsonb and prefs ?& array['v', 'back', 'felt', 'autoVoice', 'voiceVol']
        and prefs - array['v', 'back', 'felt', 'autoVoice', 'voiceVol'] = '{}'::jsonb
        and jsonb_typeof(prefs -> 'autoVoice') = 'boolean' and jsonb_typeof(prefs -> 'voiceVol') = 'string')
  )
else false end);
comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'mj_chat:20261023';

-- 自我檢查：不成立就丟錯，整份不生效
do $$
declare
  r text;
  p text;
  b record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.mj_chat_rate', p) then
        raise exception '聊天冷卻表鎖權限沒有完成：% 還有 %，整份不生效', r, p;
      end if;
    end loop;
    if has_function_privilege(r, 'public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)', 'execute') then
      raise exception '聊天冷卻函式鎖權限沒有完成：% 還能執行，整份不生效', r;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mj_chat_rate') then
    raise exception '聊天冷卻表不應該有 policy，整份不生效';
  end if;

  select public, file_size_limit, allowed_mime_types into b from storage.buckets where id = 'mj-voice';
  if not found or b.public is distinct from false or b.file_size_limit is distinct from 262144
     or b.allowed_mime_types is distinct from array['audio/mp4'] then
    raise exception '語音 bucket mj-voice 設定不對（要私有、256KB、只收 audio/mp4），整份不生效';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'storage.objects 沒有開 RLS，公開金鑰可能讀得到語音檔，整份不生效';
  end if;
  -- 公開金鑰（public、anon、authenticated）能用的 storage.objects policy：一定要限定 bucket_id，而且不能提到 mj-voice
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%'
           or coalesce(qual, '') || coalesce(with_check, '') like '%mj-voice%')
  ) then
    raise exception 'storage.objects 有公開金鑰可用、沒限定 bucket 或提到 mj-voice 的 policy，語音檔可能外流，整份不生效';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.mj_user_prefs'::regclass and conname = 'mj_user_prefs_prefs_check'
                 and obj_description(oid, 'pg_constraint') = 'mj_chat:20261023') then
    raise exception '偏好設定的格式限制沒有換成 v2／v3 版本，整份不生效';
  end if;
end $$;

commit;

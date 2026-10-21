-- 回滾 20261023_mahjong_chat.sql：刪掉聊天冷卻的表和函式，偏好設定的格式限制換回只收 v2。不動其他資料表。
--
-- 步驟（照順序）：
--   1. 先清掉語音 bucket：node --env-file=<正式環境變數檔> --import ./scripts/ts-register.mjs scripts/mj-voice-purge.ts --yes
--      （Supabase 不允許用 SQL 刪 storage 的檔案和 bucket，只能走 Storage API；腳本會列出、刪光 mj-voice 的檔案，再刪 bucket）
--      ⚠️ 變數檔要是正式環境的（.env.local 指向開發專案）；腳本會先印出目標專案網址，先不加 --yes 跑一次確認。
--   2. 再跑這份 SQL。
--   bucket 沒清也能跑這份（會出 NOTICE 提醒）：bucket 是私有的、沒有 policy，留著不會外洩；
--   但之後要重新套用 20261023 前，一定要先跑步驟 1，否則套用會因為「mj-voice 不是這份建的」被拒絕。
--
-- ⚠️ 偏好設定：v3 的列會轉回 v2（只留 v、back、felt；語音的自動播放、音量設定會丟掉，牌背、桌布保留），
--    再把格式限制換回 20261022 的版本。要保留就先匯出：copy (select * from mj_user_prefs) to stdout。
--
-- 只動有標記註解 'mj_chat:20261023' 的物件（這份 migration 建的）。
-- 如果同名的表或函式不是這份建的（沒有標記），就整份拒絕、什麼都不刪；物件不存在則什麼都不做（可以重跑）。
begin;

do $$
declare
  v_marker constant text := 'mj_chat:20261023';
  v_tbl oid := to_regclass('public.mj_chat_rate');
  v_fn oid := to_regprocedure('public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)');
  v_prefs oid := to_regclass('public.mj_user_prefs');
  v_n int;
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕回滾：public.mj_chat_rate 不是 20261023_mahjong_chat.sql 建的，不刪';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mj_chat_take'
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕回滾：public.mj_chat_take 不是 20261023_mahjong_chat.sql 建的，不刪';
  end if;

  if v_fn is not null then
    drop function public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz);
  end if;
  if v_tbl is not null then
    drop table public.mj_chat_rate;
  end if;

  -- 偏好設定：只有限制是這份換的（有標記）才換回去
  if v_prefs is not null and exists (
    select 1 from pg_constraint where conrelid = v_prefs and conname = 'mj_user_prefs_prefs_check'
      and obj_description(oid, 'pg_constraint') = v_marker
  ) then
    update public.mj_user_prefs
    set prefs = jsonb_build_object('v', 2, 'back', prefs -> 'back', 'felt', prefs -> 'felt'), updated_at = now()
    where prefs -> 'v' = '3'::jsonb;
    get diagnostics v_n = row_count;
    raise notice '偏好設定：% 列從 v3 轉回 v2', v_n;
    alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
    -- 和 20261022_mahjong_prefs.sql 的定義一樣
    alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
      prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb
      and prefs -> 'v' = '2'::jsonb and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
      and pg_column_size(prefs) <= 1024
    else false end);
  end if;

  if to_regclass('storage.buckets') is not null and exists (select 1 from storage.buckets where id = 'mj-voice') then
    raise notice '語音 bucket mj-voice 還在：請跑 node --env-file=<正式環境變數檔> --import ./scripts/ts-register.mjs scripts/mj-voice-purge.ts --yes 清掉（私有、沒有 policy，留著不會外洩）';
  end if;
end $$;

commit;

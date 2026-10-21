-- 回滾 20261024_mahjong_prefs_v4.sql：v4 的列轉回 v3，格式限制換回 20261023 的版本（標記 'mj_chat:20261023'，之後 20261023 的回滾照樣能用）。
-- 不動其他資料表。
--
-- ⚠️ v4 轉 v3 會失去：兩個靜音、互動音效音量；語音音量 0～100 換回最接近的三段（< 53 低、< 85 一般、其餘高）。
--    牌背、桌布、自動播放保留。要保留就先匯出：copy (select * from mj_user_prefs) to stdout。
-- ⚠️ 要先把程式退回 v3 版本（或同時），否則 v4 程式讀到 v3 會照常轉換，但存檔（只送 v4）會被換回的限制擋下回 500。
--
-- 只在格式限制是 20261024 換上的（有標記）時才動；否則什麼都不做（可以重跑）。
begin;

do $$
declare
  v_prefs oid := to_regclass('public.mj_user_prefs');
  v_n int;
begin
  if v_prefs is null or not exists (
    select 1 from pg_constraint where conrelid = v_prefs and conname = 'mj_user_prefs_prefs_check'
      and obj_description(oid, 'pg_constraint') = 'mj_prefs_v4:20261024'
  ) then
    raise notice '格式限制不是 20261024 換上的，不動';
    return;
  end if;
  update public.mj_user_prefs
  set prefs = jsonb_build_object('v', 3, 'back', prefs -> 'back', 'felt', prefs -> 'felt', 'autoVoice', prefs -> 'autoVoice',
        'voiceVol', case when (prefs ->> 'voiceVol')::int < 53 then 'low' when (prefs ->> 'voiceVol')::int < 85 then 'mid' else 'high' end),
      updated_at = now()
  where prefs -> 'v' = '4'::jsonb;
  get diagnostics v_n = row_count;
  raise notice '偏好設定：% 列從 v4 轉回 v3', v_n;
  alter table public.mj_user_prefs drop constraint mj_user_prefs_prefs_check;
  -- 和 20261023_mahjong_chat.sql 的定義一樣
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
end $$;

commit;

-- 麻將偏好設定 v4：語音、互動音效各一條 0～100 音量和靜音（2026-10-24）
--
-- 修改：mj_user_prefs 的格式限制（mj_user_prefs_prefs_check）。原本（20261023_mahjong_chat.sql）收 v2、v3，
--   改成 v2、v3 或 v4 { v: 4, back, felt, voiceVol: 0～100 整數, voiceMuted: 布林, fxVol: 0～100 整數, fxMuted: 布林, autoVoice: 布林 }。
--   只放寬、不改資料：之前存的 v2、v3 由伺服器讀出時轉成 v4，使用者下次存設定時才寫成 v4。
--   牌背、桌布的白名單在伺服器（lib/mahjong/userPrefs/rules.ts）。前提是 20261022、20261023 都已經套用。
-- 不新增表、函式、權限；「關閉互動」是本房的前端狀態，不入庫。
--
-- 既有同名物件：換上的格式限制加上標記註解 'mj_prefs_v4:20261024'。
--   要替換的限制一定要是 20261023 換上的（標記 'mj_chat:20261023'），而且定義和 20261023 的完全一樣才換；
--   沒有標記、別的標記、或定義被改過，就整份拒絕、什麼都不改。看到自己的標記就照常（可以重跑）。
-- 回滾見 20261024_mahjong_prefs_v4_rollback.sql。
begin;

do $$
declare
  v_marker constant text := 'mj_prefs_v4:20261024';
  v_prefs oid := to_regclass('public.mj_user_prefs');
  v_cmt text;
  v_def text;
  v_ref text;
begin
  if v_prefs is null or obj_description(v_prefs, 'pg_class') is distinct from 'mj_prefs:20261022' then
    raise exception '拒絕套用：public.mj_user_prefs 不存在或不是 20261022_mahjong_prefs.sql 建的；請先套用那份';
  end if;
  select obj_description(oid, 'pg_constraint'), pg_get_constraintdef(oid) into v_cmt, v_def from pg_constraint
  where conrelid = v_prefs and conname = 'mj_user_prefs_prefs_check';
  if v_cmt is distinct from v_marker then
    if v_def is null then
      raise exception '拒絕套用：mj_user_prefs 沒有 mj_user_prefs_prefs_check（格式限制不見了），請先確認';
    end if;
    if v_cmt is distinct from 'mj_chat:20261023' then
      raise exception '拒絕套用：mj_user_prefs_prefs_check 不是 20261023_mahjong_chat.sql 換上的（標記是 %）；請先套用那份或確認是誰改的', coalesce(v_cmt, '沒有標記');
    end if;
    -- 在同一個資料庫用 20261023 的寫法建一張暫存表，拿 pg_get_constraintdef 的結果逐字比（格式由同一個資料庫產生，不受版本影響）
    create temp table mj_v4_ref (prefs jsonb, constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
      pg_column_size(prefs) <= 1024
      and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
      and (
        (prefs -> 'v' = '2'::jsonb and prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb)
        or (prefs -> 'v' = '3'::jsonb and prefs ?& array['v', 'back', 'felt', 'autoVoice', 'voiceVol']
            and prefs - array['v', 'back', 'felt', 'autoVoice', 'voiceVol'] = '{}'::jsonb
            and jsonb_typeof(prefs -> 'autoVoice') = 'boolean' and jsonb_typeof(prefs -> 'voiceVol') = 'string')
      )
    else false end));
    select pg_get_constraintdef(oid) into v_ref from pg_constraint where conrelid = 'pg_temp.mj_v4_ref'::regclass;
    drop table pg_temp.mj_v4_ref;
    if v_def is distinct from v_ref then
      raise exception '拒絕套用：mj_user_prefs_prefs_check 有 20261023 的標記，但定義和 20261023 不同（可能被手動改過），不蓋掉；目前是 %', v_def;
    end if;
  end if;
end $$;

-- 格式限制：v2、v3 照舊，加上 v4。音量要是 0～100 的整數（jsonb 數字，不收 70.5、"70"）
alter table public.mj_user_prefs drop constraint if exists mj_user_prefs_prefs_check;
alter table public.mj_user_prefs add constraint mj_user_prefs_prefs_check check (case when jsonb_typeof(prefs) = 'object' then
  pg_column_size(prefs) <= 1024
  and jsonb_typeof(prefs -> 'back') = 'string' and jsonb_typeof(prefs -> 'felt') = 'string'
  and (
    (prefs -> 'v' = '2'::jsonb and prefs ?& array['v', 'back', 'felt'] and prefs - array['v', 'back', 'felt'] = '{}'::jsonb)
    or (prefs -> 'v' = '3'::jsonb and prefs ?& array['v', 'back', 'felt', 'autoVoice', 'voiceVol']
        and prefs - array['v', 'back', 'felt', 'autoVoice', 'voiceVol'] = '{}'::jsonb
        and jsonb_typeof(prefs -> 'autoVoice') = 'boolean' and jsonb_typeof(prefs -> 'voiceVol') = 'string')
    or (prefs -> 'v' = '4'::jsonb
        and prefs ?& array['v', 'back', 'felt', 'voiceVol', 'voiceMuted', 'fxVol', 'fxMuted', 'autoVoice']
        and prefs - array['v', 'back', 'felt', 'voiceVol', 'voiceMuted', 'fxVol', 'fxMuted', 'autoVoice'] = '{}'::jsonb
        and jsonb_typeof(prefs -> 'voiceVol') = 'number' and jsonb_typeof(prefs -> 'fxVol') = 'number'
        and (prefs ->> 'voiceVol')::numeric between 0 and 100 and (prefs ->> 'voiceVol')::numeric = trunc((prefs ->> 'voiceVol')::numeric)
        and (prefs ->> 'fxVol')::numeric between 0 and 100 and (prefs ->> 'fxVol')::numeric = trunc((prefs ->> 'fxVol')::numeric)
        and jsonb_typeof(prefs -> 'voiceMuted') = 'boolean' and jsonb_typeof(prefs -> 'fxMuted') = 'boolean'
        and jsonb_typeof(prefs -> 'autoVoice') = 'boolean')
  )
else false end);
comment on constraint mj_user_prefs_prefs_check on public.mj_user_prefs is 'mj_prefs_v4:20261024';

-- 自我檢查：不成立就丟錯，整份不生效
do $$
declare
  r text;
  p text;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.mj_user_prefs'::regclass and conname = 'mj_user_prefs_prefs_check'
                 and obj_description(oid, 'pg_constraint') = 'mj_prefs_v4:20261024') then
    raise exception '偏好設定的格式限制沒有換成 v2／v3／v4 版本，整份不生效';
  end if;
  -- 權限不是這份改的，順手確認沒有被放寬：公開金鑰碰不到偏好設定
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege(r, 'public.mj_user_prefs', p) then
        raise exception '偏好設定表的權限不對：% 有 %，整份不生效', r, p;
      end if;
    end loop;
  end loop;
end $$;

commit;

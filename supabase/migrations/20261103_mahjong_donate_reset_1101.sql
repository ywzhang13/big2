-- 斗內卡自摸次數「從 2026-11-01 00:00（台灣時間）起從 0 開始」（老闆 2026-11-01）
--
-- 做法：資料一筆都不刪。mj_zimo_wins、mj_donations、mj_fx_audit 都不動（操作紀錄只新增 1 筆）。
--   ① 先把 mj_donate_acks 整張複製到 mj_donate_acks_backup_20261101（回滾用）
--   ② 每個有自摸紀錄或歸零列的帳號：歸零點＝max(原本, 11/1 00:00)，還欠的次數（carried）、看過次數（seen_count）歸 0，
--      歸零方式記成 'system'（後台顯示「系統重置」），reset_cleared＝重置前的次數
--      → 次數＝11/1 之後的自摸數（mj_donate_count 本來就是「歸零點之後的自摸＋還欠的」，函式不用改）；
--        記一筆的自動抵扣、後台清單、應斗金額都跟著從 0 開始；斗內卡在次數 > 看過次數時才出現
--   ③ 操作紀錄寫 1 筆 action='zimo_reset_all'（target_user_id='all'），detail 記重置時間點、人數、清掉的總次數
-- 只新增：新表、檢查限制放寬（reset_source 多 'system'、action 多 'zimo_reset_all'）、資料更新。只會做一次：已經有 zimo_reset_all 紀錄就什麼都不做。
-- 回滾見 20261103_mahjong_donate_reset_1101_rollback.sql（從備份表還原 mj_donate_acks）。
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mj_donate_acks' and column_name = 'carried') then
    raise exception '拒絕套用：請先套用 20261102_mahjong_donate_deduct.sql';
  end if;
end $$;

-- 放寬檢查限制（舊資料都符合）
alter table public.mj_donate_acks drop constraint if exists mj_donate_acks_deduct_check;
alter table public.mj_donate_acks add constraint mj_donate_acks_deduct_check
  check (carried >= 0 and seen_count >= 0 and (reset_source is null or reset_source in ('donation', 'clear', 'system')) and (reset_cleared is null or reset_cleared >= 0));
alter table public.mj_fx_audit drop constraint if exists mj_fx_audit_action_check;
alter table public.mj_fx_audit add constraint mj_fx_audit_action_check
  check (action in ('donation_add', 'donation_void', 'fx_grant', 'fx_revoke', 'fx_select', 'zimo_clear', 'zimo_reset_all'));

do $$
declare
  v_cut constant timestamptz := '2026-11-01T00:00:00+08:00';
  v_users int;
  v_total int;
begin
  if exists (select 1 from public.mj_fx_audit where action = 'zimo_reset_all') then
    raise notice '已經重置過，這次不動';
    return;
  end if;

  -- ① 備份（整張表、所有欄位）
  if to_regclass('public.mj_donate_acks_backup_20261101') is null then
    create table public.mj_donate_acks_backup_20261101 as select * from public.mj_donate_acks;
    comment on table public.mj_donate_acks_backup_20261101 is 'mj_donate_reset:20261103 重置前的 mj_donate_acks';
    alter table public.mj_donate_acks_backup_20261101 enable row level security;
    revoke all on table public.mj_donate_acks_backup_20261101 from public, anon, authenticated;
    grant select on table public.mj_donate_acks_backup_20261101 to service_role;
  end if;

  -- ② 重置前的次數，算好再改
  create temp table _before on commit drop as
    select u.user_id, public.mj_donate_count(u.user_id) as n
    from (select user_id from public.mj_zimo_wins union select user_id from public.mj_donate_acks) u;
  select count(*), coalesce(sum(n), 0) into v_users, v_total from _before;

  insert into public.mj_donate_acks (user_id, acked_at)
  select b.user_id, v_cut from _before b
  where not exists (select 1 from public.mj_donate_acks a where a.user_id = b.user_id);

  update public.mj_donate_acks a set
    acked_at = greatest(a.acked_at, v_cut),
    carried = 0,
    seen_count = 0,
    reset_source = 'system',
    reset_cleared = b.n
  from _before b where b.user_id = a.user_id;

  -- ③ 操作紀錄
  insert into public.mj_fx_audit (at, actor_id, action, target_user_id, detail)
  values (now(), 'system', 'zimo_reset_all', 'all',
          jsonb_build_object('cutoff', v_cut, 'users', v_users, 'cleared', v_total, 'reason', '老闆 2026-11-01：自摸次數從 11/1 起從 0 開始，舊紀錄保留不刪'));
end $$;

-- 自我檢查：公開金鑰讀不到備份表
do $$
begin
  if to_regclass('public.mj_donate_acks_backup_20261101') is not null
     and (has_table_privilege('anon', 'public.mj_donate_acks_backup_20261101', 'select') or has_table_privilege('authenticated', 'public.mj_donate_acks_backup_20261101', 'select')) then
    raise exception '備份表權限不對：公開金鑰讀得到，整份不生效';
  end if;
end $$;

commit;

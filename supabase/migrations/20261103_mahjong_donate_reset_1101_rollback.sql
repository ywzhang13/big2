-- 回滾 20261103_mahjong_donate_reset_1101.sql：從 mj_donate_acks_backup_20261101 把 mj_donate_acks 還原成重置前的樣子。
--   ・備份裡有的帳號：所有欄位改回備份的值
--   ・重置時才新增的列（備份裡沒有）：刪掉（重置前這些人本來就沒有歸零列）
--   ・⚠️ 重置之後才發生的記帳、清除、看過，會跟著被蓋回重置前的值；回滾前先確認這段期間沒有記帳，或先匯出 mj_donate_acks
--   ・操作紀錄不能刪也不能改：zimo_reset_all 那筆照樣留著，action 和 reset_source 的檢查限制維持放寬
--   ・備份表保留（確認沒問題後再手動 drop）；備份表不存在就什麼都不做
begin;

do $$
begin
  if to_regclass('public.mj_donate_acks_backup_20261101') is null then
    raise notice '沒有備份表，不動';
    return;
  end if;
  delete from public.mj_donate_acks a
  where not exists (select 1 from public.mj_donate_acks_backup_20261101 b where b.user_id = a.user_id);
  update public.mj_donate_acks a set
    acked_at = b.acked_at, carried = b.carried, seen_count = b.seen_count, reset_source = b.reset_source, reset_cleared = b.reset_cleared
  from public.mj_donate_acks_backup_20261101 b where b.user_id = a.user_id;
end $$;

commit;

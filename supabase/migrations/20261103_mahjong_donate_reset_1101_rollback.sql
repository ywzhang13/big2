-- 回滾 20261103_mahjong_donate_reset_1101.sql：把 11/1 重置清掉的次數還回去，不蓋掉重置之後才發生的事（2026-11-01 審伯複查後改寫）
--
-- 每個被重置的帳號（重置當下有自摸紀錄或歸零列的人）分兩種：
--   ・重置後沒動過（歸零列還是重置寫下的樣子：方式 system、看過 0、還欠＝重置保留的、歸零點＝重置設的）：
--     整列還原成備份的值；重置時才新增的列（備份裡沒有）刪掉。重置後的新自摸本來就不存在列裡，照樣算進次數
--   ・重置後動過（記過帳、看過斗內卡）：那一列保持現狀（記帳的抵扣、看過次數、歸零點都不動），
--     只把重置清掉的次數加回還欠的次數（carried），所以次數＝重置前的次數＋重置後的增減
--     ⚠️ 重置後那筆記帳的打賞（超過當時應斗的部分）不會回頭抵舊的次數：記帳當下就已經結算，回滾不改斗內紀錄
-- 清掉的次數照備份和自摸紀錄重新算（不看 reset_cleared，因為記帳會覆寫它）：
--   清掉＝重置前次數 −（重置保留的＋歸零點之後到重置那刻的自摸）
-- 不刪、不改任何自摸、斗內、操作紀錄（zimo_reset_all 那筆照樣留著；檢查限制維持放寬）。
-- 只會做一次：做完把備份表改名成 mj_donate_acks_backup_20261101_rolled_back（資料保留），再跑一次就找不到備份表、什麼都不做。
-- 備份表或 zimo_reset_all 紀錄不存在＝重置沒套用過，什麼都不做。
begin;

do $$
declare
  v_cut constant timestamptz := '2026-11-01T00:00:00+08:00';
  v_reset timestamptz;
begin
  if to_regclass('public.mj_donate_acks_backup_20261101') is null then
    raise notice '沒有備份表（沒重置過或已經回滾過），不動';
    return;
  end if;
  select min(at) into v_reset from public.mj_fx_audit where action = 'zimo_reset_all';
  if v_reset is null then
    raise notice '沒有 zimo_reset_all 紀錄，不動';
    return;
  end if;

  -- 重置當下每個人：重置前次數 n、重置保留的 kept、重置後的歸零點 acked_after（和重置那份的算法一樣，只是時間點固定在 v_reset）
  create temp table _rb on commit drop as
    select x.*,
           x.n - x.kept - (select count(*)::int from public.mj_zimo_wins w where w.user_id = x.user_id and w.won_at > x.acked_after and w.won_at <= v_reset) as cleared
    from (
      select u.user_id, b.user_id is not null as had_row,
             coalesce(b.carried, 0) + (select count(*)::int from public.mj_zimo_wins w where w.user_id = u.user_id and w.won_at > coalesce(b.acked_at, '-infinity') and w.won_at <= v_reset) as n,
             case when b.acked_at > v_cut
                  then least(b.carried, (select count(*)::int from public.mj_zimo_wins w where w.user_id = u.user_id and w.won_at > v_cut and w.won_at <= b.acked_at))
                  else 0 end as kept,
             greatest(coalesce(b.acked_at, '-infinity'), v_cut) as acked_after
      from (select user_id from public.mj_zimo_wins where won_at <= v_reset union select user_id from public.mj_donate_acks_backup_20261101) u
      left join public.mj_donate_acks_backup_20261101 b on b.user_id = u.user_id
    ) x;

  -- 重置後沒動過的列
  create temp table _untouched on commit drop as
    select r.user_id, r.had_row from _rb r join public.mj_donate_acks a on a.user_id = r.user_id
    where a.reset_source = 'system' and a.seen_count = 0 and a.carried = r.kept and a.acked_at = r.acked_after;

  delete from public.mj_donate_acks a using _untouched t where t.user_id = a.user_id and not t.had_row;
  update public.mj_donate_acks a set
    acked_at = b.acked_at, carried = b.carried, seen_count = b.seen_count, reset_source = b.reset_source, reset_cleared = b.reset_cleared
  from public.mj_donate_acks_backup_20261101 b, _untouched t
  where b.user_id = a.user_id and t.user_id = a.user_id;

  -- 重置後動過的列：只把清掉的次數加回去
  update public.mj_donate_acks a set carried = a.carried + r.cleared
  from _rb r
  where r.user_id = a.user_id and r.cleared > 0 and not exists (select 1 from _untouched t where t.user_id = a.user_id);

  alter table public.mj_donate_acks_backup_20261101 rename to mj_donate_acks_backup_20261101_rolled_back;
  comment on table public.mj_donate_acks_backup_20261101_rolled_back is 'mj_donate_reset:20261103 重置前的 mj_donate_acks（已回滾）';
end $$;

commit;

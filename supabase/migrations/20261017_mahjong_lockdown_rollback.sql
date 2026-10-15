-- 回滾 20261017_mahjong_lockdown.sql：恢復 mj_rooms／mj_players「任何人都能讀寫」的 policy（和 mahjong-schema.sql 原本的一樣）。
-- 要把程式退回 f85aa16 以前（用公開金鑰讀寫這兩張表）時，先跑這份。
begin;

drop policy if exists "Allow all on mj_rooms" on mj_rooms;
drop policy if exists "Allow all on mj_players" on mj_players;
create policy "Allow all on mj_rooms" on mj_rooms for all using (true) with check (true);
create policy "Allow all on mj_players" on mj_players for all using (true) with check (true);

commit;

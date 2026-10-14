-- 回滾 20261016_match_records.sql：只移除那份新增的東西，現有房間、玩家資料不受影響。
-- ⚠️ 會連同已寫入的對局紀錄一起刪掉；回滾前先匯出 match_records、match_record_players。
-- 順序：先把程式退回不寫紀錄的版本，再跑這份。（就算順序反了，遊戲也照常：寫紀錄失敗就不刪房；
--       大老二建房會自動改用不帶 records_enabled 的寫法。）
begin;

drop function if exists close_room_with_record(text, uuid, jsonb, bigint, int);

drop trigger if exists trg_mj_rooms_updated_at on mj_rooms;
drop trigger if exists trg_big2_rooms_updated_at on big2_rooms;
drop function if exists games_touch_room();   -- 只刪遊戲專用的；共用的 set_updated_at() 不能動
drop index if exists idx_mj_rooms_status_updated;
drop index if exists idx_big2_rooms_status_updated;
alter table mj_rooms drop column if exists updated_at;
alter table big2_rooms drop column if exists updated_at;
alter table big2_rooms drop column if exists records_enabled;
alter table mj_rooms drop column if exists row_version;
alter table big2_rooms drop column if exists row_version;

drop table if exists match_record_players;
drop table if exists match_records;

commit;

-- 回滾 20261113_mahjong_replay.sql：只刪那份新增的表和函式（回放資料一起刪掉），其他表、舊資料都不動。
-- 回滾前請先把程式退回不寫回放的版本（或接受寫回放失敗只記 log：lib/mahjong/replay/record.ts 不會讓牌局存檔失敗）。
begin;
drop function if exists public.mj_replay_hand(uuid, int);
drop function if exists public.mj_replay_hands(uuid);
drop function if exists public.mj_replay_match(uuid, uuid, timestamptz);
drop function if exists public.mj_replay_save(uuid, int, jsonb, jsonb, timestamptz);
drop function if exists public.mj_replay_purge(timestamptz);
drop table if exists public.mj_hand_replays;
commit;

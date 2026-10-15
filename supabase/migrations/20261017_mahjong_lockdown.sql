-- 麻將 LINE 登入（2026-10-17）第二步：新程式上線、確認健康「之後」才跑
-- 拿掉 mj_rooms／mj_players「任何人都能讀寫」的 policy：之前用公開金鑰就能直接讀到四家手牌、改牌局。
-- 新程式的麻將路由一律用 service role（會略過 RLS），前端只用 Realtime 廣播、不直接讀這兩張表，所以不受影響。
-- ⚠️ 舊程式（f85aa16 以前）用公開金鑰讀寫這兩張表，跑完這份後舊程式的麻將會全部失敗：
--    一定要確認正式站已經是新版才能跑；要退回舊程式前，先跑 20261017_mahjong_lockdown_rollback.sql。
-- 大老二的 big2_rooms／big2_players 不動（大老二不接登入）。
begin;

drop policy if exists "Allow all on mj_rooms" on mj_rooms;
drop policy if exists "Allow all on mj_players" on mj_players;
-- RLS 維持開啟、不建任何 policy：公開金鑰（anon、authenticated）讀不到也寫不了

commit;

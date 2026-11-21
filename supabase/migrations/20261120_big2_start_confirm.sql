-- 大老二開局確認（老柯 2026-11-20，老闆定案：房主按開始倒數 10 秒、四家都同意才發牌、沒按完不開局）。
-- 只新增兩個可以是 null 的欄位，不動現有資料、權限、trigger（row_version 照舊每次更新 +1）：
--   start_confirm       jsonb：這次開局確認 { startedBy, seatIds, readyIds, deadline }（見 lib/lobby/startConfirm.ts）；沒有＝null
--   last_start_confirm  jsonb：上一次為什麼沒開成 { reason: timeout|host|seats_changed, missingIds, at }；房主重新按開始、開局時清掉
--   新表 big2_seat_keys（room_id, player_id, key_hash）：入座憑證的 sha256（審伯複審 R4）。入座時伺服器產生一張只回給本人的憑證，
--     資料庫只存雜湊；發起、取消開局確認要帶房主本人的憑證（大老二沒有登入，公開的玩家 id 不能當身分）。
--     big2_rooms／big2_players 給公開金鑰讀寫（大老二整套靠這個），雜湊放那裡任何人都能改成自己的值，所以獨立一張表：
--     開 RLS、不建任何 policy、收回 public／anon／authenticated 的權限（Supabase 預設會給新表），只有伺服器（service_role）讀寫。
--     房間刪掉時跟著刪（外鍵 on delete cascade）。上線前入座的座位沒有雜湊＝不能發起，要重新入座。
-- 舊程式不讀這兩欄也不碰新表，所以「先套 migration、再推程式」任何時間點都相容；反過來（新程式先上）會讀不到，大老二開不了局。
-- 回滾：20261120_big2_start_confirm_rollback.sql（刪掉兩欄和新表；要先退回程式）。
begin;

do $$
begin
  if to_regclass('public.big2_rooms') is null then
    raise exception '拒絕套用：找不到 big2_rooms';
  end if;
end $$;

alter table public.big2_rooms add column if not exists start_confirm jsonb;
alter table public.big2_rooms add column if not exists last_start_confirm jsonb;
comment on column public.big2_rooms.start_confirm is 'big2_start_confirm:20261120 開局確認';
create table if not exists public.big2_seat_keys (
  room_id uuid not null references public.big2_rooms(id) on delete cascade,
  player_id text not null,
  key_hash text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
alter table public.big2_seat_keys enable row level security;   -- 不建 policy：anon、authenticated 就算有權限也看不到、寫不進任何一列
revoke all on table public.big2_seat_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.big2_seat_keys to service_role;
comment on table public.big2_seat_keys is 'big2_start_confirm:20261120 大老二入座憑證的 sha256，只有伺服器讀寫';
comment on column public.big2_rooms.last_start_confirm is 'big2_start_confirm:20261120 上一次沒開成的原因';

commit;

-- 十三支共用聊天紀錄（老柯 2026-11-17）：讓 20261113 的聊天紀錄函式也認得十三支房間（th_rooms），麻將行為不變。
-- 只改兩個函式（create or replace，參數、回傳、權限都不變）：
--   ① mj_chat_lock_room：先照舊鎖 mj_rooms 那一列；找不到再鎖 th_rooms 那一列（for share）。房間 id 都是 uuid，兩張表不會撞，
--      麻將房的結果和原本完全一樣；十三支房間關房（close_room_with_record 刪 th_rooms 那一列）一樣要等寫入放開鎖
--   ② mj_chat_append 的保底清除：「房間已經不在」改成兩張表都找不到才算——不然任何一則麻將聊天都會把十三支房間的聊天當成孤兒刪掉
-- mj_chat_post、mj_chat_history、mj_chat_messages、冷卻表都不動。前提：20261113_mahjong_chat_history.sql、20261116_thirteen_rooms.sql 已套用。
-- 回滾：20261117_thirteen_chat_rollback.sql（兩個函式換回 20261113 原文）
begin;

do $$
begin
  if to_regprocedure('public.mj_chat_lock_room(text)') is null or to_regclass('public.mj_chat_messages') is null then
    raise exception '拒絕套用：找不到 20261113 的聊天紀錄函式';
  end if;
  if to_regclass('public.th_rooms') is null then
    raise exception '拒絕套用：找不到 th_rooms，請先套用 20261116_thirteen_rooms.sql';
  end if;
end $$;

create or replace function public.mj_chat_lock_room(p_room text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mj_chat:' || p_room, 0));
  perform 1 from mj_rooms r where r.id::text = p_room for share;
  if found then
    return true;
  end if;
  perform 1 from th_rooms r where r.id::text = p_room for share;  -- 十三支房間
  return found;
end
$$;
comment on function public.mj_chat_lock_room(text) is 'mj_chat_history:20261113 thirteen:20261117';

create or replace function public.mj_chat_append(p_room text, p_msg jsonb, p_keep int, p_now timestamptz default now())
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if not mj_chat_lock_room(p_room) then
    return false; -- 房間已經關了：不寫
  end if;
  insert into mj_chat_messages (room_id, msg, created_at) values (p_room, p_msg, p_now);
  -- 只留這房最近 p_keep 則（已經拿到這房的鎖，不會和同房的另一則交錯）
  delete from mj_chat_messages
  where room_id = p_room
    and seq <= (select seq from mj_chat_messages where room_id = p_room order by seq desc offset p_keep limit 1);
  -- 保底：房間已經不在的聊天（關房時漏刪的）；還開著的房（麻將或十三支）一律不動
  delete from mj_chat_messages m where m.room_id <> p_room
    and not exists (select 1 from mj_rooms r where r.id::text = m.room_id)
    and not exists (select 1 from th_rooms r where r.id::text = m.room_id);
  return true;
end
$$;
comment on function public.mj_chat_append(text, jsonb, int, timestamptz) is 'mj_chat_history:20261113 thirteen:20261117';

commit;

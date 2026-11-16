-- 回滾 20261117_thirteen_chat.sql（老柯 2026-11-17）：兩個函式換回 20261113_mahjong_chat_history.sql 的原文（程式直接從原檔擷取）。
-- 順序：先把程式退回不含十三支聊天的版本。回滾後十三支房間不能再寫聊天，而且下一則麻將聊天會把十三支房間的聊天當成孤兒刪掉（和 20261113 原本行為相同）。
begin;

create or replace function public.mj_chat_lock_room(p_room text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mj_chat:' || p_room, 0));
  perform 1 from mj_rooms r where r.id::text = p_room for share;
  return found;
end
$$;
comment on function public.mj_chat_lock_room(text) is 'mj_chat_history:20261113';

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
  -- 保底：房間已經不在的聊天（關房時漏刪的）；還開著的房一律不動
  delete from mj_chat_messages m where m.room_id <> p_room and not exists (select 1 from mj_rooms r where r.id::text = m.room_id);
  return true;
end
$$;
comment on function public.mj_chat_append(text, jsonb, int, timestamptz) is 'mj_chat_history:20261113';

commit;

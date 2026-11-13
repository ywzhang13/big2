-- 麻將聊天紀錄：每間房保存這一場的聊天（老闆 2026-11-13：「聊天訊息保存在該局遊戲就好」）
-- 新增（只新增、不改舊資料）：
--   ① mj_chat_messages：一列一則（文字、快捷短語、語音）；msg 是給前端的訊息內容（語音只存檔案路徑，讀取時再簽發網址）
--   ② mj_chat_append(房, 訊息, 保留則數)：寫入一則，只留這房最近 N 則；順手清掉 2 天前的列（關房時漏刪的保底）
--   ③ mj_chat_post(...)：文字聊天用，「檢查冷卻＋記下＋寫入」一次完成（呼叫既有的 mj_chat_take），和現在一樣只有一次資料庫呼叫
--   ④ mj_chat_history(房)：這房目前保存的訊息，舊到新
-- 關房時由伺服器刪掉這房的列（lib/mahjong/chat/store.ts deleteRoomChat，和語音檔、冷卻紀錄一起）。
-- room_id 用 text、不綁外鍵（和 mj_chat_rate 一樣）。
-- 權限：只給 service_role；anon、authenticated、PUBLIC 沒有任何權限、沒有 policy；最後自我檢查不成立就整份不生效。
-- 前提：20261023_mahjong_chat.sql 已套用（要用 mj_chat_take）。回滾見 20261113_mahjong_chat_history_rollback.sql。
begin;

do $$
begin
  if to_regprocedure('public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)') is null then
    raise exception '拒絕套用：找不到 mj_chat_take，請先套用 20261023_mahjong_chat.sql';
  end if;
  if to_regclass('public.mj_chat_messages') is not null then
    raise exception '拒絕套用：public.mj_chat_messages 已經存在（已經套用過？）';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mj_chat_append', 'mj_chat_post', 'mj_chat_history')) then
    raise exception '拒絕套用：mj_chat_append／mj_chat_post／mj_chat_history 已經存在';
  end if;
end $$;

create table public.mj_chat_messages (
  room_id text not null,
  seq bigint generated always as identity,
  msg jsonb not null check (jsonb_typeof(msg) = 'object' and pg_column_size(msg) <= 2048),
  created_at timestamptz not null default now(),
  primary key (room_id, seq)
);
create index mj_chat_messages_created_at on public.mj_chat_messages (created_at);
comment on table public.mj_chat_messages is 'mj_chat_history:20261113';
alter table public.mj_chat_messages enable row level security;
revoke all on table public.mj_chat_messages from public, anon, authenticated, service_role;
grant select, insert, delete on table public.mj_chat_messages to service_role;

create function public.mj_chat_append(p_room text, p_msg jsonb, p_keep int, p_now timestamptz default now())
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into mj_chat_messages (room_id, msg, created_at) values (p_room, p_msg, p_now);
  -- 只留這房最近 p_keep 則
  delete from mj_chat_messages
  where room_id = p_room
    and seq <= (select seq from mj_chat_messages where room_id = p_room order by seq desc offset p_keep limit 1);
  -- 保底：2 天前的列（房間早就關了、關房時漏刪）
  delete from mj_chat_messages where created_at < p_now - interval '2 days';
end
$$;
comment on function public.mj_chat_append(text, jsonb, int, timestamptz) is 'mj_chat_history:20261113';

create function public.mj_chat_post(
  p_room text, p_user text, p_kind text,
  p_cooldown_ms int, p_burst_count int, p_burst_window_ms int, p_burst_cooldown_ms int,
  p_msg jsonb, p_keep int, p_now timestamptz default now())
returns int
language plpgsql
set search_path = public
as $$
declare
  v_wait int;
begin
  v_wait := mj_chat_take(p_room, p_user, p_kind, p_cooldown_ms, p_burst_count, p_burst_window_ms, p_burst_cooldown_ms, true, p_now);
  if v_wait > 0 then
    return v_wait; -- 被冷卻擋下：什麼都不寫
  end if;
  perform mj_chat_append(p_room, p_msg, p_keep, p_now);
  return 0;
end
$$;
comment on function public.mj_chat_post(text, text, text, int, int, int, int, jsonb, int, timestamptz) is 'mj_chat_history:20261113';

create function public.mj_chat_history(p_room text)
returns table (msg jsonb)
language sql
stable
set search_path = public
as $$
  select m.msg from mj_chat_messages m where m.room_id = p_room order by m.seq
$$;
comment on function public.mj_chat_history(text) is 'mj_chat_history:20261113';

do $$
declare
  f text;
begin
  foreach f in array array['public.mj_chat_append(text, jsonb, int, timestamptz)',
                           'public.mj_chat_post(text, text, text, int, int, int, int, jsonb, int, timestamptz)',
                           'public.mj_chat_history(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '聊天紀錄函式鎖權限沒有完成：%，整份不生效', f;
    end if;
  end loop;
  foreach f in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'public.mj_chat_messages', f) or has_table_privilege('authenticated', 'public.mj_chat_messages', f) then
      raise exception '聊天紀錄表鎖權限沒有完成：公開金鑰還有 %，整份不生效', f;
    end if;
  end loop;
end $$;

commit;

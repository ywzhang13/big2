-- LINE 長期授權（refresh token），只用來在大頭照網址失效時跟 LINE 換新照片（老柯 2026-11-19，老闆定案乙案；審伯 4 項必修後的版本）。
-- 為什麼要存：Supabase 只在 LINE 登入那一刻更新照片；登入一次可以撐好幾週，期間玩家換了 LINE 大頭照，舊網址就 404，
-- 不重新登入就拿不到新的。所以登入時把 LINE 給的 refresh token 加密存下來，照片失效時用它跟 LINE 換一次。
--
-- 兩張表（都開 RLS、沒有 policy，只有 service_role 能讀寫；PUBLIC／anon／authenticated 全部收回）：
--   line_tokens        一個帳號一列：sealed＝伺服器用 LINE_TOKEN_KEY 加密（AES-256-GCM，綁帳號 id）的授權，資料庫沒有明文；
--                      session_key＝存這筆授權的那次登入；gen＝版本號，每次存、換發都從序號 line_tokens_gen_seq 拿新的
--                      （全域遞增、不會重複：刪了再存也不會撞到舊請求手上的版本號，舊請求寫不回來）
--   line_refresh_state 一個帳號一列：last_refresh_at＝上一次跟 LINE 換照片的時間（冷卻用，和授權分開存，刪授權不會重置冷卻）；
--                      revoked_sessions＝已登出的登入（最近 20 個），這些登入晚到的保存請求一律不收
-- 函式（只有 service_role 能執行）：
--   line_token_save(帳號, 密文, 登入)         → jsonb { ok } 或 { ok:false, reason:'revoked' }（這次登入已經登出）
--   line_token_claim(帳號, 冷卻秒數, 現在)    → jsonb { status:'ok', sealed, gen } ｜ { status:'cooldown' } ｜ { status:'none' }
--       沒存授權回 none，不吃冷卻；有授權才在同一個交易裡記下這次時間，同時進來的第二個請求一定拿到 cooldown
--   line_token_rotate(帳號, 密文, gen)        → boolean：只有授權還是 claim 時那一筆（gen 沒變）才換存 LINE 換發的新授權
--   line_token_invalidate(帳號, gen)          → boolean：LINE 說授權失效時，只刪 claim 時那一筆，不會刪到之後新存的
--   line_token_delete(帳號, 登入)             → boolean：登出。把這次登入記成已登出；只刪這次登入存的授權（重新登入後的新授權不動）
-- 回滾：20261119_line_tokens_rollback.sql（刪兩張表和五個函式；已存的授權、冷卻紀錄一起刪掉）。
begin;

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception '拒絕套用：找不到 auth.users';
  end if;
  if to_regclass('public.line_tokens') is not null or to_regclass('public.line_refresh_state') is not null then
    raise exception '拒絕套用：line_tokens／line_refresh_state 已經存在（這份已經套用過）';
  end if;
end $$;

create sequence public.line_tokens_gen_seq;

create table public.line_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sealed text not null,                               -- 加密後的 refresh token（見 lib/linePicture/crypto.ts）
  session_key text not null,                          -- 存這筆授權的那次登入（lib/linePicture/session.ts）
  gen bigint not null default nextval('public.line_tokens_gen_seq'),  -- 版本號（全域遞增）
  updated_at timestamptz not null default now()
);

create table public.line_refresh_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_refresh_at timestamptz,                        -- 上一次跟 LINE 換照片的時間（冷卻）
  revoked_sessions text[] not null default '{}'       -- 已登出的登入（最近 20 個）
);

alter table public.line_tokens enable row level security;
alter table public.line_refresh_state enable row level security;
revoke all on table public.line_tokens, public.line_refresh_state from public;
revoke all on sequence public.line_tokens_gen_seq from public;

create function public.line_token_save(p_user uuid, p_sealed text, p_session text)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('line_token:' || p_user::text, 0)); -- 同一個人的存、刪、換發排隊
  if exists (select 1 from line_refresh_state where user_id = p_user and p_session = any(revoked_sessions)) then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  insert into line_tokens (user_id, sealed, session_key, gen, updated_at) values (p_user, p_sealed, p_session, nextval('line_tokens_gen_seq'), now())
  on conflict (user_id) do update set sealed = excluded.sealed, session_key = excluded.session_key, gen = excluded.gen, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create function public.line_token_claim(p_user uuid, p_cooldown_seconds int, p_now timestamptz default now())
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tok line_tokens%rowtype;
  v_hit int;
begin
  select * into v_tok from line_tokens where user_id = p_user;
  if not found then
    return jsonb_build_object('status', 'none');  -- 還沒存授權：不吃冷卻（存好之後馬上可以換）
  end if;
  insert into line_refresh_state (user_id, last_refresh_at) values (p_user, p_now)
  on conflict (user_id) do update set last_refresh_at = p_now
    where line_refresh_state.last_refresh_at is null
       or line_refresh_state.last_refresh_at <= p_now - make_interval(secs => p_cooldown_seconds);
  get diagnostics v_hit = row_count;
  if v_hit = 0 then
    return jsonb_build_object('status', 'cooldown');
  end if;
  return jsonb_build_object('status', 'ok', 'sealed', v_tok.sealed, 'gen', v_tok.gen);
end $$;

create function public.line_token_rotate(p_user uuid, p_sealed text, p_gen bigint)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('line_token:' || p_user::text, 0));
  update line_tokens set sealed = p_sealed, gen = nextval('line_tokens_gen_seq'), updated_at = now() where user_id = p_user and gen = p_gen;
  return found;
end $$;

create function public.line_token_invalidate(p_user uuid, p_gen bigint)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('line_token:' || p_user::text, 0));
  delete from line_tokens where user_id = p_user and gen = p_gen;
  return found;
end $$;

create function public.line_token_delete(p_user uuid, p_session text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('line_token:' || p_user::text, 0));
  insert into line_refresh_state (user_id, revoked_sessions) values (p_user, array[p_session])
  on conflict (user_id) do update
    set revoked_sessions = (array[p_session] || array_remove(line_refresh_state.revoked_sessions, p_session))[1:20];
  delete from line_tokens where user_id = p_user and session_key = p_session;
  return found;
end $$;

comment on table public.line_tokens is 'line_tokens:20261119';
comment on table public.line_refresh_state is 'line_tokens:20261119';
comment on function public.line_token_save(uuid, text, text) is 'line_tokens:20261119';
comment on function public.line_token_claim(uuid, int, timestamptz) is 'line_tokens:20261119';
comment on function public.line_token_rotate(uuid, text, bigint) is 'line_tokens:20261119';
comment on function public.line_token_invalidate(uuid, bigint) is 'line_tokens:20261119';
comment on function public.line_token_delete(uuid, text) is 'line_tokens:20261119';
revoke all on function public.line_token_save(uuid, text, text), public.line_token_claim(uuid, int, timestamptz), public.line_token_rotate(uuid, text, bigint),
  public.line_token_invalidate(uuid, bigint), public.line_token_delete(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.line_tokens, public.line_refresh_state from anon, authenticated;
    revoke all on function public.line_token_save(uuid, text, text), public.line_token_claim(uuid, int, timestamptz), public.line_token_rotate(uuid, text, bigint),
      public.line_token_invalidate(uuid, bigint), public.line_token_delete(uuid, text) from anon, authenticated;
    revoke all on sequence public.line_tokens_gen_seq from anon, authenticated;
    grant select, insert, update, delete on table public.line_tokens, public.line_refresh_state to service_role;
    grant usage on sequence public.line_tokens_gen_seq to service_role;
    grant execute on function public.line_token_save(uuid, text, text), public.line_token_claim(uuid, int, timestamptz), public.line_token_rotate(uuid, text, bigint),
      public.line_token_invalidate(uuid, bigint), public.line_token_delete(uuid, text) to service_role;
  end if;
end $$;

commit;

-- 回滾 20261030_mahjong_spectate.sql：刪掉觀戰的表和函式（只存觀戰申請與同意，刪掉不影響牌局；正在觀戰的人會看不到）。不動其他資料表。
-- 只刪有標記註解 'mj_spectate:20261030' 的物件。同名物件不是這份建的就整份拒絕；物件不存在則什麼都不做（可以重跑）。
begin;

do $$
declare
  v_marker constant text := 'mj_spectate:20261030';
  v_tbl oid := to_regclass('public.mj_spectate');
begin
  if v_tbl is not null and obj_description(v_tbl, 'pg_class') is distinct from v_marker then
    raise exception '拒絕回滾：public.mj_spectate 不是 20261030_mahjong_spectate.sql 建的，不刪';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('mj_spectate_request', 'mj_spectate_respond', 'mj_spectate_revoke')
             and obj_description(oid, 'pg_proc') is distinct from v_marker) then
    raise exception '拒絕回滾：mj_spectate_request／respond／revoke 不是 20261030_mahjong_spectate.sql 建的，不刪';
  end if;
  drop function if exists public.mj_spectate_request(text, text, text, text, text, int, timestamptz);
  drop function if exists public.mj_spectate_respond(text, text, uuid, boolean, int, timestamptz);
  drop function if exists public.mj_spectate_revoke(text, text, uuid, timestamptz);
  drop table if exists public.mj_spectate; -- 索引跟著表一起刪
end $$;

commit;

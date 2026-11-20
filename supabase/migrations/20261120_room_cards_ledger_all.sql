-- 房卡後台「全部流水帳」查詢（老柯 2026-11-20；小宜房卡設計說明 v1.2 第 4-4 節）。要先套 20261120_room_cards.sql。
-- 只新增一個唯讀函式 room_card_ledger_all，不改任何資料表、不改既有函式、不碰扣卡邏輯。
--   room_card_ledger_all(種類, 從何時起, 筆數, 游標時間, 游標來源, 游標 id, 排除的帳號) → jsonb { entries, stats }
--   ・所有人的充值、扣卡、回收（room_card_ledger）和暫停、恢復（room_card_audit）合在一起，時間由新到舊；
--     同一時間用（來源、id）排定順序，keyset 分頁不會漏也不會重複
--   ・種類：null＝全部；'topup'／'charge'／'reclaim'／'suspend'／'resume' 只看那一種
--   ・從何時起：null＝全部期間；給時間就只看那之後的（今天／本週／本月由程式算好傳進來）
--   ・排除的帳號：老闆帳號（老闆不扣卡，本來就沒有帳；保險起見再排除一次）
--   ・stats：這段期間（不看種類）充值、扣卡、回收各幾張（都是正數）
-- 權限：只有 service_role 能執行。回滾：20261120_room_cards_ledger_all_rollback.sql（刪掉這個函式）。
begin;

do $$
begin
  if to_regclass('public.room_card_ledger') is null or to_regclass('public.room_card_audit') is null then
    raise exception '拒絕套用：找不到房卡的表，請先套用 20261120_room_cards.sql';
  end if;
  if to_regprocedure('public.room_card_ledger_all(text, timestamptz, int, timestamptz, text, bigint, uuid)') is not null then
    raise exception '拒絕套用：room_card_ledger_all 已經存在（這份已經套用過）';
  end if;
end $$;

create function public.room_card_ledger_all(
  p_kind text default null,
  p_since timestamptz default null,
  p_limit int default 50,
  p_cursor_at timestamptz default null,
  p_cursor_src text default null,
  p_cursor_id bigint default null,
  p_skip uuid default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  with feed as (
    select 'l'::text as src, id, created_at, user_id, kind, delta, balance_after, game, room_code, hand_no, actor
      from room_card_ledger
    union all
    select 'a'::text, id, created_at, user_id, action, null::int, null::int, null::text, null::text, null::int, actor
      from room_card_audit
  ), scoped as (
    select * from feed
     where (p_skip is null or user_id <> p_skip) and (p_since is null or created_at >= p_since)
  ), page as (
    select * from scoped
     where (p_kind is null or kind = p_kind)
       and (p_cursor_at is null or (created_at, src, id) < (p_cursor_at, p_cursor_src, p_cursor_id))
     order by created_at desc, src desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 101)
  )
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('src', src, 'id', id, 'at', created_at, 'userId', user_id, 'kind', kind, 'cards', delta,
               'balanceAfter', balance_after, 'game', game, 'roomCode', room_code, 'handNo', hand_no, 'actor', actor)
             order by created_at desc, src desc, id desc)
        from page), '[]'::jsonb),
    'stats', (select jsonb_build_object(
                'topup', coalesce(sum(delta) filter (where kind = 'topup'), 0),
                'charge', coalesce(-sum(delta) filter (where kind = 'charge'), 0),
                'reclaim', coalesce(-sum(delta) filter (where kind = 'reclaim'), 0)) from scoped)
  )
$$;

revoke all on function public.room_card_ledger_all(text, timestamptz, int, timestamptz, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.room_card_ledger_all(text, timestamptz, int, timestamptz, text, bigint, uuid) to service_role;
comment on function public.room_card_ledger_all(text, timestamptz, int, timestamptz, text, bigint, uuid) is 'room_cards_ledger_all:20261120';

commit;

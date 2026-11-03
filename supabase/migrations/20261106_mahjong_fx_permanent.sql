-- 特效開通改成永久（老闆 2026-11-04）：目前還在有效期內的開通轉成永久。
--   永久＝mj_fx_grants.expires_at 存 'infinity'。不用改表、不用改函式：既有的 expires_at > now 判斷、收回都照常成立。
--   舊開通列不能改（防改觸發器），所以不是更新，而是替這些人「新增」6 列永久開通（granted_by='system'），舊列原樣保留；每人寫 1 筆 fx_grant 操作紀錄。
--   不轉的：已過期、已收回的（不自動恢復）；qa- 測試帳號（開通者是 qa-、或帳號名稱／email 以 qa- 開頭）；已經有永久開通的。可以重跑，不會多寫。
--   ⚠️ 順序：先推程式、再套這份。舊程式把 'infinity' 解析成 NaN，自摸會退回金色。
--   回滾見 20261106_mahjong_fx_permanent_rollback.sql。
begin;

do $$
declare
  v_now timestamptz := now();
  v_fx constant text[] := array['meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura'];
  r record;
begin
  if to_regclass('public.mj_fx_grants') is null then
    raise exception '拒絕套用：請先套用 20261031_mahjong_zimo_fx.sql';
  end if;
  for r in
    select distinct g.user_id
    from public.mj_fx_grants g
    left join auth.users u on u.id::text = g.user_id
    where g.revoked_at is null and g.expires_at > v_now and g.granted_by not ilike 'qa-%'
      and coalesce(u.email, '') not ilike 'qa-%'
      and coalesce(u.raw_user_meta_data ->> 'name', '') not ilike 'qa-%'
      and coalesce(u.raw_user_meta_data ->> 'full_name', '') not ilike 'qa-%'
      and not exists (select 1 from public.mj_fx_grants p where p.user_id = g.user_id and p.revoked_at is null and p.expires_at = 'infinity')
  loop
    insert into public.mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
    select r.user_id, f, 'system', v_now, 'infinity'::timestamptz from unnest(v_fx) f;
    insert into public.mj_fx_audit (at, actor_id, action, target_user_id, detail)
    values (v_now, 'system', 'fx_grant', r.user_id, jsonb_build_object('fx', to_jsonb(v_fx), 'active', null, 'expires_at', 'infinity', 'migrate', true,
            'reason', '老闆 2026-11-04：開通改成永久，還在有效期內的轉成永久'));
  end loop;
end $$;

commit;

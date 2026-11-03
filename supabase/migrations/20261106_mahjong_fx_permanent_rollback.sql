-- 回滾 20261106_mahjong_fx_permanent.sql：永久開通全部收回，一筆都不刪（紀錄不能刪）。
--   ・收回所有有效的永久開通（expires_at='infinity'），包含上線後老闆新開的
--   ・被收回的人如果沒有其他還有效的舊開通（例如上線後才開的），補 6 列有期限的開通，到下週日 23:59:59，不會突然沒有特效；
--     轉永久的人舊的有期限開通本來就留著，照原本的到期日繼續有效
--   ・每人各寫操作紀錄（fx_revoke、需要補開通的再加 fx_grant），detail 標 rollback
--   ⚠️ 順序：先跑這份、再退程式（舊程式看到還有效的 'infinity' 會讓自摸退回金色）
begin;

do $$
declare
  v_now timestamptz := now();
  v_fx constant text[] := array['meteor', 'thunder', 'storm', 'frost', 'blackhole', 'sakura'];
  v_until timestamptz := (date_trunc('week', now() at time zone 'Asia/Taipei') + interval '14 days') at time zone 'Asia/Taipei';
  r record;
begin
  for r in select distinct g.user_id from public.mj_fx_grants g where g.revoked_at is null and g.expires_at = 'infinity' loop
    if not exists (select 1 from public.mj_fx_grants t where t.user_id = r.user_id and t.revoked_at is null and t.expires_at > v_now and t.expires_at <> 'infinity') then
      insert into public.mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at)
      select r.user_id, f, 'system', v_now, v_until from unnest(v_fx) f;
      insert into public.mj_fx_audit (at, actor_id, action, target_user_id, detail)
      values (v_now, 'system', 'fx_grant', r.user_id, jsonb_build_object('fx', to_jsonb(v_fx), 'active', null, 'expires_at', v_until, 'rollback', true));
    end if;
    update public.mj_fx_grants set revoked_at = v_now, revoked_by = 'system'
    where user_id = r.user_id and revoked_at is null and expires_at = 'infinity';
    insert into public.mj_fx_audit (at, actor_id, action, target_user_id, detail)
    values (v_now, 'system', 'fx_revoke', r.user_id, jsonb_build_object('fx', 'all', 'rollback', true, 'reason', '回滾永久開通'));
  end loop;
end $$;

commit;

-- Active Context / tenant-isolation cutover assertions.
-- Read-only catalog/data checks; creates no fixture or business data.
do $$
declare unsafe_count integer; missing_scope_count integer; bad_rpc_count integer;
begin
 select count(*) into unsafe_count from pg_policies where schemaname='public' and tablename = any(array['boq_items','boq_sections','boq_additions','inventory_transactions','inventory_transaction_reversals','cash_transactions','documents','project_control','project_personnel','audit_logs']) and cmd in ('SELECT','ALL') and roles @> array['authenticated']::name[] and lower(trim(coalesce(qual,''))) in ('true','(true)');
 if unsafe_count>0 then raise exception 'FAIL: % permissive authenticated SELECT policies still bypass scope guards',unsafe_count; end if;
 select coalesce(sum(n),0)::integer into missing_scope_count from (
 select count(*) n from public.boq_items where workspace_id is null or project_id is null union all select count(*) from public.boq_sections where workspace_id is null or project_id is null union all select count(*) from public.boq_additions where workspace_id is null or project_id is null union all select count(*) from public.inventory_transactions where workspace_id is null or project_id is null union all select count(*) from public.inventory_transaction_reversals where workspace_id is null or project_id is null union all select count(*) from public.cash_transactions where workspace_id is null or project_id is null union all select count(*) from public.documents where workspace_id is null or project_id is null union all select count(*) from public.project_control where workspace_id is null or project_id is null union all select count(*) from public.project_personnel where workspace_id is null or project_id is null union all select count(*) from public.audit_logs where workspace_id is null or project_id is null) s;
 if missing_scope_count>0 then raise exception 'FAIL: % legacy rows still have incomplete workspace/project scope',missing_scope_count; end if;
 if has_function_privilege('anon','public.resolve_my_active_context()','EXECUTE') then raise exception 'FAIL: anon can execute active context resolver'; end if;
 if not has_function_privilege('authenticated','public.resolve_my_active_context()','EXECUTE') then raise exception 'FAIL: authenticated cannot execute active context resolver'; end if;
 select count(*) into bad_rpc_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_my_active_context' and (p.prosecdef or p.provolatile<>'s');
 if bad_rpc_count<>0 then raise exception 'FAIL: resolver must remain STABLE SECURITY INVOKER'; end if;
 raise notice 'PASS: tenant isolation cutover preconditions satisfied';
end $$;

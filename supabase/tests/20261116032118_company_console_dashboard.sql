-- Structural/security regression for Company Console dashboard RPC.
do $$
declare v_oid oid; v_def text;
begin
  select 'public.get_company_console_dashboard(uuid)'::regprocedure into v_oid;
  if v_oid is null then raise exception 'Company dashboard RPC is missing'; end if;
  if not (select prosecdef from pg_proc where oid=v_oid) then raise exception 'Company dashboard must execute with SECURITY DEFINER'; end if;
  select pg_get_functiondef(v_oid) into v_def;
  if position('auth.uid()' in v_def)=0 or position('is_company_super_admin' in v_def)=0
    or position('p_workspace_id' in v_def)=0 or position('recent_activity' in v_def)=0
    or position('npwp_ciphertext' in v_def)>0 or position('npwp_fingerprint' in v_def)>0 then
    raise exception 'Company dashboard authorization, workspace scope, activity, or data-minimization contract is incomplete';
  end if;
  if has_function_privilege('anon',v_oid,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_oid),acldefault('f',(select proowner from pg_proc where oid=v_oid)))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    or not has_function_privilege('authenticated',v_oid,'EXECUTE') then
    raise exception 'Company dashboard RPC EXECUTE grants are not least-privilege';
  end if;
end $$;

-- The administrative SQL execution context has no authenticated JWT and must fail closed.
do $$
begin
  perform public.get_company_console_dashboard(null);
  raise exception 'Unauthenticated dashboard invocation unexpectedly succeeded';
exception
  when sqlstate '28000' then null;
end $$;

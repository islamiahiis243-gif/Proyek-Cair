-- Security and scope regression for Project Assignment & Coverage.
do $$
declare v_oid oid; v_def text;
begin
 select 'public.get_company_project_assignment_coverage(uuid)'::regprocedure into v_oid;
 if v_oid is null then raise exception 'Project Assignment & Coverage RPC missing'; end if;
 if not (select prosecdef from pg_proc where oid=v_oid) then raise exception 'Coverage RPC must be SECURITY DEFINER'; end if;
 select pg_get_functiondef(v_oid) into v_def;
 if position('auth.uid()' in v_def)=0 or position('is_company_super_admin' in v_def)=0
  or position('workspace_type' in v_def)=0 or position('project_membership_permissions' in v_def)=0
  or position('unassigned_members' in v_def)=0 then raise exception 'Coverage authorization, workspace scope, permission coverage or unassigned-member logic missing'; end if;
 if has_function_privilege('anon',v_oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_oid),acldefault('f',(select proowner from pg_proc where oid=v_oid)))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  or not has_function_privilege('authenticated',v_oid,'EXECUTE') then raise exception 'Coverage RPC EXECUTE grants are not least privilege'; end if;
 if position('role_permission_catalog' in v_def)>0 then raise exception 'Coverage RPC must not infer or expand role permission bundles'; end if;
end $$;
do $$ begin
 perform public.get_company_project_assignment_coverage(null);
 raise exception 'Unauthenticated coverage invocation unexpectedly succeeded';
exception when sqlstate '28000' then null;
end $$;

-- Project assignment RPC must add membership only and never grant permissions.
do $$
declare v_oid oid; v_def text;
begin
 select 'public.assign_company_member_to_project(uuid,uuid)'::regprocedure into v_oid;
 if v_oid is null then raise exception 'Project assignment RPC missing'; end if;
 if not (select prosecdef from pg_proc where oid=v_oid) then raise exception 'Assignment RPC must be SECURITY DEFINER'; end if;
 select pg_get_functiondef(v_oid) into v_def;
 if position('auth.uid()' in v_def)=0 or position('is_company_super_admin' in v_def)=0
  or position('membership_status' in v_def)=0 or position('PROJECT_MEMBER_ASSIGNED' in v_def)=0
  or position('project_membership_permissions' in v_def)>0 or position('role_permission_catalog' in v_def)>0 then
  raise exception 'Assignment RPC guard, audit, or no-implicit-permission invariant failed';
 end if;
 if has_function_privilege('anon',v_oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_oid),acldefault('f',(select proowner from pg_proc where oid=v_oid)))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  or not has_function_privilege('authenticated',v_oid,'EXECUTE') then raise exception 'Assignment RPC EXECUTE grants are not least privilege'; end if;
end $$;
do $$ begin
 perform public.assign_company_member_to_project(null,null);
 raise exception 'Unauthenticated assignment unexpectedly succeeded';
exception when sqlstate '28000' then null;
end $$;

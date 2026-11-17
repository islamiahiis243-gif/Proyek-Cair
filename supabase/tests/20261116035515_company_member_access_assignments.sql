do $$
declare r record; v_def text;
begin
  for r in
    select p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
      has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
      has_function_privilege('public',p.oid,'EXECUTE') public_exec,
      pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('get_company_member_access_assignments','assign_company_member_access','revoke_company_member_access')
  loop
    if not r.prosecdef then raise exception '% must be SECURITY DEFINER',r.proname; end if;
    if not ('search_path=""'=any(r.proconfig)) then raise exception '% must pin empty search_path',r.proname; end if;
    if r.anon_exec or r.public_exec or not r.auth_exec then raise exception '% has invalid EXECUTE grants',r.proname; end if;
    if position('auth.uid()' in r.definition)=0 then raise exception '% must bind caller to auth.uid()',r.proname; end if;
    if position('is_company_super_admin' in r.definition)=0 then raise exception '% must require Company Super Admin',r.proname; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_company_member_access_assignments','assign_company_member_access','revoke_company_member_access'))<>3 then
    raise exception 'Expected all three Company Member Access RPCs';
  end if;
  select pg_get_functiondef('private.has_project_permission(uuid,text)'::regprocedure) into v_def;
  if position('role_permission_catalog' in v_def)=0 or position('company_membership_role_assignments' in v_def)=0 then
    raise exception 'Effective project permission resolver no longer consumes approved Role assignments/mappings';
  end if;
  select pg_get_functiondef('public.assign_company_member_access(uuid,uuid,text,text,timestamp with time zone,text,uuid,jsonb,numeric,text)'::regprocedure) into v_def;
  if position('permission_grants_added' in v_def)=0 then
    raise exception 'Assignment audit must record zero direct permission grants';
  end if;
  begin
    perform public.get_company_member_access_assignments(null);
    raise exception 'Unauthenticated read unexpectedly succeeded';
  exception when sqlstate '28000' then null; end;
  begin
    perform public.assign_company_member_access(null,null,'ROLE','VIEWER',null,'regression test reason');
    raise exception 'Unauthenticated assignment unexpectedly succeeded';
  exception when sqlstate '28000' then null; end;
  begin
    perform public.revoke_company_member_access(null,'ROLE',null,'regression test reason');
    raise exception 'Unauthenticated revoke unexpectedly succeeded';
  exception when sqlstate '28000' then null; end;
end $$;

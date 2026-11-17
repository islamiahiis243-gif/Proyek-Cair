do $test$
declare
 v_def text;
 v_policy record;
begin
 if not (select relrowsecurity from pg_class where oid='public.user_active_persona_contexts'::regclass) then
  raise exception 'Active Persona context RLS must remain enabled';
 end if;
 select * into v_policy from pg_policies
  where schemaname='public' and tablename='user_active_persona_contexts'
   and policyname='user_active_persona_contexts_read_own' and cmd='SELECT'
   and roles @> array['authenticated']::name[];
 if not found or position('auth.uid()' in coalesce(v_policy.qual,''))=0 or position('user_id' in coalesce(v_policy.qual,''))=0 then
  raise exception 'Active Persona context SELECT policy must be caller-owned only';
 end if;
 if not has_table_privilege('authenticated','public.user_active_persona_contexts','SELECT')
  or has_table_privilege('authenticated','public.user_active_persona_contexts','INSERT')
  or has_table_privilege('authenticated','public.user_active_persona_contexts','UPDATE')
  or has_table_privilege('authenticated','public.user_active_persona_contexts','DELETE')
  or has_table_privilege('anon','public.user_active_persona_contexts','SELECT') then
  raise exception 'Active Persona context must be owner-readable and RPC-write-only';
 end if;

 select pg_get_functiondef('public.resolve_my_active_context()'::regprocedure) into v_def;
 if (select prosecdef from pg_proc where oid='public.resolve_my_active_context()'::regprocedure)
  or (select provolatile from pg_proc where oid='public.resolve_my_active_context()'::regprocedure)<>'s'
  or position('active_persona_code' in v_def)=0
  or position('user_active_persona_contexts' in v_def)=0
  or position('persona_catalog' in v_def)=0
  or position('p.status=''ACTIVE''' in v_def)=0
  or position('approved_by is not null' in v_def)=0
  or position('approved_at is not null' in v_def)=0 then
  raise exception 'Resolver must remain STABLE INVOKER and return only active Persona-gated projects with approved Role mappings';
 end if;

 select pg_get_functiondef('private.set_my_active_persona(uuid,text)'::regprocedure) into v_def;
 if not (select prosecdef from pg_proc where oid='private.set_my_active_persona(uuid,text)'::regprocedure)
  or position('auth.uid()' in v_def)=0
  or position('workspace_type=''COMPANY''' in v_def)=0
  or position('w.status=''ACTIVE''' in v_def)=0
  or position('membership_status=''ACTIVE''' in v_def)=0
  or position('persona_catalog' in v_def)=0
  or position('starts_at<=now()' in v_def)=0
  or position('ends_at>now()' in v_def)=0
  or position('revoked_at is null' in v_def)=0
  or position('pg_advisory_xact_lock' in v_def)=0
  or position('workspace.active_persona.changed' in v_def)=0 then
  raise exception 'Persona setter must serialize and validate caller, active Workspace/Membership, active assignment/catalog and audit the change';
 end if;

 foreach v_def in array array[
  pg_get_functiondef('private.has_project_permission(uuid,text)'::regprocedure),
  pg_get_functiondef('private.user_has_project_permission(uuid,uuid,text)'::regprocedure)
 ] loop
  if position('user_active_persona_contexts' in v_def)=0
   or position('company_membership_persona_assignments' in v_def)=0
   or position('persona_catalog' in v_def)=0
   or position('workspace_type=''COMPANY''' in v_def)=0
   or position('w.status=''ACTIVE''' in v_def)=0
   or position('approved_by is not null' in v_def)=0
   or position('approved_at is not null' in v_def)=0 then
   raise exception 'Project permission resolver must require valid active Persona and Platform-approved Role mapping';
  end if;
 end loop;

 if not has_function_privilege('authenticated','public.set_my_active_persona(uuid,text)','EXECUTE')
  or has_function_privilege('anon','public.set_my_active_persona(uuid,text)','EXECUTE')
  or not has_function_privilege('authenticated','public.resolve_my_active_context()','EXECUTE')
  or has_function_privilege('anon','public.resolve_my_active_context()','EXECUTE') then
  raise exception 'Active Persona RPC grants must remain authenticated-only';
 end if;

 begin
  perform public.set_my_active_persona(null,null);
  raise exception 'Unauthenticated Persona selection unexpectedly succeeded';
 exception when sqlstate '28000' then null; end;
end
$test$;

-- Read-only regression for the Project.close lifecycle contract.
do $$
declare
 v_definition text;
 v_trigger_count integer;
 v_permission record;
begin
 select * into v_permission
 from public.project_permission_catalog
 where permission_code='project.close' and active;
 if not found or v_permission.module<>'project' or v_permission.action<>'close'
    or v_permission.risk_level<>'HIGH' or not v_permission.requires_authority_check then
  raise exception 'project.close must remain an active HIGH-risk authority-gated permission';
 end if;

 select pg_get_functiondef('private.close_company_project(uuid,text)'::regprocedure)
 into v_definition;
 if position('private.has_project_permission' in v_definition)=0
    or position('project.close' in v_definition)=0
    or position('PROJECT_CLOSED' in v_definition)=0
    or position('COMPLETED' in v_definition)=0
    or position('8' in v_definition)=0 then
  raise exception 'Project close RPC must enforce permission, reason, COMPLETED transition and audit event';
 end if;

 select count(*) into v_trigger_count
 from pg_trigger t
 join pg_class c on c.oid=t.tgrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='projects'
   and t.tgname='projects_guard_lifecycle_transition' and not t.tgisinternal;
 if v_trigger_count<>1 then
  raise exception 'Project lifecycle status guard trigger is missing';
 end if;

 select pg_get_functiondef('private.guard_project_lifecycle_transition()'::regprocedure)
 into v_definition;
 if position('ACTIVE' in v_definition)=0
    or position('COMPLETED' in v_definition)=0
    or position('app.project_lifecycle_transition' in v_definition)=0 then
  raise exception 'Direct project status updates must be rejected outside the guarded close RPC';
 end if;

 if has_function_privilege('anon','public.close_company_project(uuid,text)','EXECUTE') then
  raise exception 'Anonymous execution of Project close RPC must be revoked';
 end if;
 if not has_function_privilege('authenticated','public.close_company_project(uuid,text)','EXECUTE') then
  raise exception 'Authenticated execution of Project close RPC must be granted';
 end if;
end $$;

-- Enforce the SSOT project.close lifecycle action in the database.
-- Direct table updates cannot close or reopen a Project; only the guarded RPC can
-- perform ACTIVE -> COMPLETED, with authority validation and an immutable audit event.

create or replace function private.guard_project_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'ACTIVE'
       or new.status <> 'COMPLETED'
       or pg_catalog.current_setting('app.project_lifecycle_transition',true) is distinct from old.id::text then
      raise exception 'Project lifecycle status can only transition ACTIVE -> COMPLETED through close_company_project';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists projects_guard_lifecycle_transition on public.projects;
create trigger projects_guard_lifecycle_transition
before update of status on public.projects
for each row execute function private.guard_project_lifecycle_transition();

create or replace function private.close_company_project(p_project_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.projects%rowtype;
  v_reason text:=pg_catalog.btrim(coalesce(p_reason,''));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_project_id is null then
    raise exception 'Project is required';
  end if;
  if pg_catalog.length(v_reason) not between 8 and 500 then
    raise exception 'Closure reason must contain 8-500 characters';
  end if;

  select * into v_project
  from public.projects
  where id=p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;
  if v_project.status <> 'ACTIVE' then
    raise exception 'Only an ACTIVE Project can be closed';
  end if;
  if not private.has_project_permission(p_project_id,'project.close') then
    raise exception 'Active project.close permission and delegated authority are required';
  end if;

  perform pg_catalog.set_config('app.project_lifecycle_transition',p_project_id::text,true);
  update public.projects
  set status='COMPLETED',updated_at=pg_catalog.now()
  where id=p_project_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
  values(
    (select auth.uid()),
    'PROJECT_CLOSED',
    'projects',
    p_project_id::text,
    pg_catalog.jsonb_build_object(
      'reason',v_reason,
      'previous_status',v_project.status,
      'new_status','COMPLETED',
      'project_code',v_project.project_code,
      'project_name',v_project.name
    ),
    v_project.workspace_id,
    p_project_id
  );

  return pg_catalog.jsonb_build_object('ok',true,'project_id',p_project_id,'status','COMPLETED');
end
$$;

revoke all on function private.close_company_project(uuid,text) from public,anon,authenticated;
grant execute on function private.close_company_project(uuid,text) to authenticated;

create or replace function public.close_company_project(p_project_id uuid,p_reason text)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.close_company_project(p_project_id,p_reason)
$$;

revoke all on function public.close_company_project(uuid,text) from public,anon;
grant execute on function public.close_company_project(uuid,text) to authenticated;

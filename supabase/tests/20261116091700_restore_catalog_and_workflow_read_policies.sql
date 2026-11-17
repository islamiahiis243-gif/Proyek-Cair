-- Read-only structural regression for 20261116091700.
do $$
declare
  v_missing text[];
  v_expr text;
begin
  select array_agg(expected.policy_name order by expected.policy_name)
    into v_missing
  from (values
    ('persona_catalog','persona_catalog_active_read'),
    ('role_catalog','role_catalog_active_read'),
    ('role_permission_catalog','role_permission_catalog_active_read'),
    ('authority_catalog','authority_catalog_active_read'),
    ('company_membership_persona_assignments','company_persona_assignment_read'),
    ('company_membership_role_assignments','company_role_assignment_read'),
    ('company_membership_authority_assignments','company_authority_assignment_read'),
    ('workflow_definitions','workflow_definitions_project_read'),
    ('workflow_instances','workflow_instances_project_read'),
    ('workflow_steps','workflow_steps_assignee_read'),
    ('workflow_events','workflow_events_project_read'),
    ('project_signatory_appointments','signatory_appointment_project_read')
  ) as expected(table_name,policy_name)
  where not exists (
    select 1 from pg_policies p
    where p.schemaname='public'
      and p.tablename=expected.table_name
      and p.policyname=expected.policy_name
      and 'authenticated'=any(p.roles)
      and p.cmd='SELECT'
  );

  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception 'Missing authenticated SELECT policies: %', array_to_string(v_missing,', ');
  end if;

  select qual into v_expr from pg_policies
   where schemaname='public' and tablename='workflow_instances'
     and policyname='workflow_instances_project_read';
  if position('can_read_workflow' in coalesce(v_expr,''))=0 then
    raise exception 'Workflow instance policy must use private.can_read_workflow';
  end if;

  select qual into v_expr from pg_policies
   where schemaname='public' and tablename='workflow_steps'
     and policyname='workflow_steps_assignee_read';
  if position('can_read_workflow' in coalesce(v_expr,''))=0 then
    raise exception 'Workflow step policy must use private.can_read_workflow';
  end if;

  select qual into v_expr from pg_policies
   where schemaname='public' and tablename='workflow_events'
     and policyname='workflow_events_project_read';
  if position('can_read_workflow' in coalesce(v_expr,''))=0 then
    raise exception 'Workflow event policy must use private.can_read_workflow';
  end if;

  -- Role-Permission remains intentionally unseeded until its mapping is approved.
  if exists(select 1 from public.role_permission_catalog where active
    and (approved_by is null or approved_at is null)) then
    raise exception 'Unapproved Role-Permission mapping detected';
  end if;
end $$;

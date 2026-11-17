-- Restore read policies removed by the final policy cleanup in migration 20261116012800.
-- Catalog rows are non-secret platform metadata; only active rows are exposed.
drop policy if exists persona_catalog_active_read on public.persona_catalog;
create policy persona_catalog_active_read
  on public.persona_catalog for select to authenticated
  using (active);

drop policy if exists role_catalog_active_read on public.role_catalog;
create policy role_catalog_active_read
  on public.role_catalog for select to authenticated
  using (active);

drop policy if exists role_permission_catalog_active_read on public.role_permission_catalog;
create policy role_permission_catalog_active_read
  on public.role_permission_catalog for select to authenticated
  using (active);

drop policy if exists authority_catalog_active_read on public.authority_catalog;
create policy authority_catalog_active_read
  on public.authority_catalog for select to authenticated
  using (active);

-- Assignment rows are visible only to the Company Super Admin of their workspace
-- or to the identity that owns the corresponding Company Membership.
drop policy if exists company_persona_assignment_read on public.company_membership_persona_assignments;
create policy company_persona_assignment_read
  on public.company_membership_persona_assignments for select to authenticated
  using (
    private.is_company_super_admin(workspace_id)
    or exists (
      select 1 from public.company_memberships m
      where m.id = company_membership_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists company_role_assignment_read on public.company_membership_role_assignments;
create policy company_role_assignment_read
  on public.company_membership_role_assignments for select to authenticated
  using (
    private.is_company_super_admin(workspace_id)
    or exists (
      select 1 from public.company_memberships m
      where m.id = company_membership_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists company_authority_assignment_read on public.company_membership_authority_assignments;
create policy company_authority_assignment_read
  on public.company_membership_authority_assignments for select to authenticated
  using (
    private.is_company_super_admin(workspace_id)
    or exists (
      select 1 from public.company_memberships m
      where m.id = company_membership_id
        and m.user_id = (select auth.uid())
    )
  );

-- Workflow visibility is project-scoped, with an explicit exception for the
-- authenticated assignee so an actor with workflow.step.act can read only
-- the workflow they are assigned to. The helper also allows Company Super Admin.
drop policy if exists workflow_definitions_project_read on public.workflow_definitions;
create policy workflow_definitions_project_read
  on public.workflow_definitions for select to authenticated
  using (
    private.has_project_permission(project_id, 'workflow.read')
    or private.has_project_permission(project_id, 'workflow.definition.create')
    or private.has_project_permission(project_id, 'workflow.definition.update')
  );

drop policy if exists workflow_instances_project_read on public.workflow_instances;
create policy workflow_instances_project_read
  on public.workflow_instances for select to authenticated
  using (private.can_read_workflow(id));

drop policy if exists workflow_steps_assignee_read on public.workflow_steps;
create policy workflow_steps_assignee_read
  on public.workflow_steps for select to authenticated
  using (private.can_read_workflow(workflow_id));

drop policy if exists workflow_events_project_read on public.workflow_events;
create policy workflow_events_project_read
  on public.workflow_events for select to authenticated
  using (private.can_read_workflow(workflow_id));

drop policy if exists signatory_appointment_project_read on public.project_signatory_appointments;
create policy signatory_appointment_project_read
  on public.project_signatory_appointments for select to authenticated
  using (
    private.has_project_permission(project_id, 'document.read')
    or private.is_company_super_admin(workspace_id)
  );

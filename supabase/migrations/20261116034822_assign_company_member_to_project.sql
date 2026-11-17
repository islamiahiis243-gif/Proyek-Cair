-- Explicit Project Membership assignment with no implicit permission grants.
create or replace function public.assign_company_member_to_project(p_project_id uuid,p_company_membership_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_project public.projects; v_member public.company_memberships; v_pm uuid;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_project from public.projects where id=p_project_id for update;
 if not found or v_project.status<>'ACTIVE' then raise exception 'Active Project not found' using errcode='P0002'; end if;
 if not private.is_company_super_admin(v_project.workspace_id) then raise exception 'Company Super Admin required for this Project' using errcode='42501'; end if;
 select * into v_member from public.company_memberships where id=p_company_membership_id and workspace_id=v_project.workspace_id and membership_status='ACTIVE' for update;
 if not found then raise exception 'Target must be an active Company Membership in the same Workspace' using errcode='23514'; end if;
 if exists(select 1 from public.project_memberships where project_id=v_project.id and company_membership_id=v_member.id) then
  raise exception 'Project Membership history already exists; review/reactivation requires a separate guarded workflow' using errcode='23505';
 end if;
 insert into public.project_memberships(project_id,workspace_id,company_membership_id,user_id,assigned_by,membership_status)
 values(v_project.id,v_project.workspace_id,v_member.id,v_member.user_id,(select auth.uid()),'ACTIVE')
 returning id into v_pm;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values((select auth.uid()),'PROJECT_MEMBER_ASSIGNED','project_membership',v_pm::text,
  jsonb_build_object('company_membership_id',v_member.id,'user_id',v_member.user_id,'permission_grants_added',0,'project_code',v_project.project_code),
  v_project.workspace_id,v_project.id);
 return v_pm;
end $$;
revoke all on function public.assign_company_member_to_project(uuid,uuid) from public,anon;
grant execute on function public.assign_company_member_to_project(uuid,uuid) to authenticated;

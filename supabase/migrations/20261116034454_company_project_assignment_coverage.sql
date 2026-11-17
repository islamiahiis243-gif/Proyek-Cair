-- Company Super Admin read-only Project Assignment & Coverage snapshot.
-- Direct permission grants are reported exactly as stored; no role bundle is inferred.
create or replace function public.get_company_project_assignment_coverage(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_company_id uuid; v_result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required for this workspace' using errcode='42501'; end if;
 select w.company_id into v_company_id from public.workspaces w where w.id=p_workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE';
 if v_company_id is null then raise exception 'Active Company Workspace not found' using errcode='P0002'; end if;
 select jsonb_build_object(
  'workspace_id',p_workspace_id,
  'active_company_members',(select count(*) from public.company_memberships cm where cm.workspace_id=p_workspace_id and cm.membership_status='ACTIVE'),
  'active_projects',(select count(*) from public.projects p where p.workspace_id=p_workspace_id and p.status='ACTIVE'),
  'active_project_memberships',(select count(*) from public.project_memberships pm join public.projects p on p.id=pm.project_id join public.company_memberships cm on cm.id=pm.company_membership_id where p.workspace_id=p_workspace_id and p.status='ACTIVE' and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE'),
  'members_without_active_project',(select count(*) from public.company_memberships cm where cm.workspace_id=p_workspace_id and cm.membership_status='ACTIVE' and not exists(select 1 from public.project_memberships pm join public.projects p on p.id=pm.project_id where pm.company_membership_id=cm.id and pm.workspace_id=p_workspace_id and pm.membership_status='ACTIVE' and p.status='ACTIVE')),
  'active_members_without_permissions',(select count(distinct pm.id) from public.project_memberships pm join public.projects p on p.id=pm.project_id join public.company_memberships cm on cm.id=pm.company_membership_id where p.workspace_id=p_workspace_id and p.status='ACTIVE' and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE' and not exists(select 1 from public.project_membership_permissions pmp join public.project_permission_catalog pc on pc.permission_code=pmp.permission_code and pc.active where pmp.project_membership_id=pm.id)),
  'projects',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'project_code',p.project_code,'name',p.name,'status',p.status,
   'active_member_count',(select count(*) from public.project_memberships pm join public.company_memberships cm on cm.id=pm.company_membership_id where pm.project_id=p.id and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE'),
   'members_without_permissions',(select count(*) from public.project_memberships pm join public.company_memberships cm on cm.id=pm.company_membership_id where pm.project_id=p.id and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE' and not exists(select 1 from public.project_membership_permissions pmp join public.project_permission_catalog pc on pc.permission_code=pmp.permission_code and pc.active where pmp.project_membership_id=pm.id)),
   'permission_code_count',(select count(distinct pmp.permission_code) from public.project_memberships pm join public.project_membership_permissions pmp on pmp.project_membership_id=pm.id join public.project_permission_catalog pc on pc.permission_code=pmp.permission_code and pc.active where pm.project_id=p.id and pm.membership_status='ACTIVE'),
   'members',coalesce((select jsonb_agg(jsonb_build_object(
    'project_membership_id',pm.id,'company_membership_id',cm.id,'user_id',cm.user_id,
    'full_name',coalesce(nullif(trim(pr.full_name),''),'Nama belum tersedia'),'membership_status',pm.membership_status,
    'permissions',coalesce((select jsonb_agg(jsonb_build_object('permission_code',pc.permission_code,'module',pc.module,'action',pc.action,'risk_level',pc.risk_level,'requires_authority_check',pc.requires_authority_check,'description',pc.description) order by pc.module,pc.action) from public.project_membership_permissions pmp join public.project_permission_catalog pc on pc.permission_code=pmp.permission_code and pc.active where pmp.project_membership_id=pm.id),'[]'::jsonb)
   ) order by pr.full_name nulls last,cm.user_id) from public.project_memberships pm join public.company_memberships cm on cm.id=pm.company_membership_id left join public.profiles pr on pr.id=cm.user_id where pm.project_id=p.id and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE'),'[]'::jsonb)
  ) order by p.created_at desc) from public.projects p where p.workspace_id=p_workspace_id),'[]'::jsonb),
  'unassigned_members',coalesce((select jsonb_agg(jsonb_build_object('company_membership_id',cm.id,'user_id',cm.user_id,'full_name',coalesce(nullif(trim(pr.full_name),''),'Nama belum tersedia'),'activated_at',cm.activated_at) order by pr.full_name nulls last,cm.user_id) from public.company_memberships cm left join public.profiles pr on pr.id=cm.user_id where cm.workspace_id=p_workspace_id and cm.membership_status='ACTIVE' and not exists(select 1 from public.project_memberships pm join public.projects p on p.id=pm.project_id where pm.company_membership_id=cm.id and pm.membership_status='ACTIVE' and p.status='ACTIVE' and p.workspace_id=p_workspace_id)),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.get_company_project_assignment_coverage(uuid) from public,anon;
grant execute on function public.get_company_project_assignment_coverage(uuid) to authenticated;

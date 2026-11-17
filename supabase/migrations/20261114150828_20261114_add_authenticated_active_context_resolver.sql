create or replace function public.resolve_my_active_context()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when (select auth.uid()) is null then jsonb_build_object('authenticated', false)
    else jsonb_build_object(
      'authenticated', true,
      'user_id', (select auth.uid()),
      'is_platform_super_admin', exists (
        select 1 from public.platform_admins pa
        where pa.user_id = (select auth.uid())
      ),
      'workspaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'type', w.workspace_type,
          'name', w.display_name,
          'status', w.status,
          'company_id', w.company_id,
          'access_basis', case
            when w.workspace_type = 'PERSONAL' then 'OWNER'
            else 'ACTIVE_COMPANY_MEMBERSHIP'
          end
        ) order by w.created_at)
        from public.workspaces w
        where
          (w.workspace_type = 'PERSONAL' and w.owner_user_id = (select auth.uid()))
          or
          (w.workspace_type = 'COMPANY' and exists (
            select 1 from public.company_memberships cm
            where cm.workspace_id = w.id
              and cm.user_id = (select auth.uid())
              and cm.membership_status = 'ACTIVE'
          ))
      ), '[]'::jsonb),
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'workspace_id', p.workspace_id,
          'project_code', p.project_code,
          'name', p.name,
          'status', p.status,
          'membership_id', pm.id,
          'permissions', coalesce((
            select jsonb_agg(pp.permission_code order by pp.permission_code)
            from public.project_membership_permissions pp
            join public.project_permission_catalog pc
              on pc.permission_code = pp.permission_code
             and pc.active = true
            where pp.project_membership_id = pm.id
          ), '[]'::jsonb)
        ) order by p.created_at)
        from public.project_memberships pm
        join public.projects p
          on p.id = pm.project_id
         and p.workspace_id = pm.workspace_id
        join public.company_memberships cm
          on cm.id = pm.company_membership_id
         and cm.workspace_id = pm.workspace_id
         and cm.user_id = (select auth.uid())
         and cm.membership_status = 'ACTIVE'
        where pm.user_id = (select auth.uid())
          and pm.membership_status = 'ACTIVE'
      ), '[]'::jsonb)
    )
  end
$$;

revoke all on function public.resolve_my_active_context() from public;
revoke all on function public.resolve_my_active_context() from anon;
grant execute on function public.resolve_my_active_context() to authenticated;

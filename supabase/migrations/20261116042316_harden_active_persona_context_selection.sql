begin;

-- Active Persona context is readable only by its owner. Writes remain RPC-only.
drop policy if exists user_active_persona_contexts_read_own on public.user_active_persona_contexts;
create policy user_active_persona_contexts_read_own
 on public.user_active_persona_contexts
 for select to authenticated
 using (user_id=(select auth.uid()));

revoke all on table public.user_active_persona_contexts from public,anon,authenticated;
grant select on table public.user_active_persona_contexts to authenticated;

-- Serialize a member's active-context switch and validate every source row at write time.
create or replace function private.set_my_active_persona(p_workspace_id uuid,p_persona_code text)
returns void language plpgsql security definer set search_path=''
as $function$
declare
 v_actor uuid;
 v_membership uuid;
 v_assignment uuid;
 v_previous text;
begin
 v_actor:=(select auth.uid());
 if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or nullif(trim(coalesce(p_persona_code,'')),'') is null then
  raise exception 'Company Workspace and Persona are required' using errcode='22023';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_workspace_id::text,0));

 select cm.id into v_membership
 from public.workspaces w
 join public.company_memberships cm on cm.workspace_id=w.id
 where w.id=p_workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE'
  and cm.user_id=v_actor and cm.membership_status='ACTIVE'
 for share of w,cm;
 if v_membership is null then raise exception 'Active Company Workspace and Company Membership required' using errcode='42501'; end if;

 select pa.id into v_assignment
 from public.company_membership_persona_assignments pa
 join public.persona_catalog pc on pc.persona_code=pa.persona_code and pc.active
 where pa.company_membership_id=v_membership and pa.workspace_id=p_workspace_id
  and pa.persona_code=trim(p_persona_code) and pa.revoked_at is null
  and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
 for share of pa,pc;
 if v_assignment is null then raise exception 'Persona is not assigned, inactive, revoked, or expired' using errcode='42501'; end if;

 select ap.persona_code into v_previous
 from public.user_active_persona_contexts ap
 where ap.user_id=v_actor and ap.workspace_id=p_workspace_id
 for update;
 if v_previous is not distinct from trim(p_persona_code) then return; end if;

 insert into public.user_active_persona_contexts(user_id,workspace_id,persona_code)
 values(v_actor,p_workspace_id,trim(p_persona_code))
 on conflict(user_id,workspace_id) do update
 set persona_code=excluded.persona_code,updated_at=now();

 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values(v_actor,p_workspace_id,'workspace.active_persona.changed','persona_context',v_actor::text,
  jsonb_build_object('previous_persona_code',v_previous,'persona_code',trim(p_persona_code)));
end
$function$;

-- Keep the resolver SECURITY INVOKER. Its SELECT on the context row is now protected by owner-only RLS.
-- Projects are returned only when the caller has a currently valid active Persona context.
create or replace function public.resolve_my_active_context()
returns jsonb language sql stable set search_path=''
as $function$
 select case when (select auth.uid()) is null then jsonb_build_object('authenticated',false)
 else jsonb_build_object(
  'authenticated',true,'user_id',(select auth.uid()),
  'is_platform_super_admin',private.is_platform_super_admin(),
  'workspaces',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',w.id,'type',w.workspace_type,'name',w.display_name,'status',w.status,'company_id',w.company_id,
    'access_basis',case when w.workspace_type='PERSONAL' then 'OWNER' else 'ACTIVE_COMPANY_MEMBERSHIP' end,
    'personas',coalesce((select jsonb_agg(jsonb_build_object('persona_code',pa.persona_code,'display_name',pc.display_name,'description',pc.description) order by pc.sort_order,pc.display_name)
      from public.company_memberships cm
      join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.workspace_id=cm.workspace_id
      join public.persona_catalog pc on pc.persona_code=pa.persona_code and pc.active
      where cm.workspace_id=w.id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
       and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())), '[]'::jsonb),
    'active_persona_code',(select ap.persona_code
      from public.user_active_persona_contexts ap
      join public.company_memberships cm on cm.workspace_id=ap.workspace_id and cm.user_id=ap.user_id and cm.membership_status='ACTIVE'
      join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.workspace_id=cm.workspace_id and pa.persona_code=ap.persona_code
      join public.persona_catalog pc on pc.persona_code=pa.persona_code and pc.active
      where ap.user_id=(select auth.uid()) and ap.workspace_id=w.id
       and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
      limit 1)
   ) order by w.created_at)
   from public.workspaces w where w.status='ACTIVE' and
    ((w.workspace_type='PERSONAL' and w.owner_user_id=(select auth.uid()))
     or (w.workspace_type='COMPANY' and exists(select 1 from public.company_memberships cm
       where cm.workspace_id=w.id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE')))
  ),'[]'::jsonb),
  'projects',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',p.id,'workspace_id',p.workspace_id,'project_code',p.project_code,'name',p.name,'status',p.status,'membership_id',pm.id,
    'permissions',coalesce((select jsonb_agg(x.permission_code order by x.permission_code) from (
      select pp.permission_code from public.project_membership_permissions pp where pp.project_membership_id=pm.id
      union
      select rp.permission_code
      from public.company_membership_role_assignments ra
      join public.role_catalog rc on rc.role_code=ra.role_code and rc.active
      join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.active
       and rp.approved_by is not null and rp.approved_at is not null
      where ra.company_membership_id=cm.id and ra.workspace_id=cm.workspace_id
       and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
    ) x join public.project_permission_catalog pc on pc.permission_code=x.permission_code and pc.active), '[]'::jsonb)
   ) order by p.created_at)
   from public.project_memberships pm
   join public.projects p on p.id=pm.project_id and p.workspace_id=pm.workspace_id and p.status='ACTIVE'
   join public.workspaces w on w.id=p.workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE'
   join public.company_memberships cm on cm.id=pm.company_membership_id and cm.workspace_id=pm.workspace_id
    and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
   where pm.user_id=(select auth.uid()) and pm.membership_status='ACTIVE'
    and exists(select 1 from public.user_active_persona_contexts ap
      join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id
       and pa.workspace_id=cm.workspace_id and pa.persona_code=ap.persona_code
      join public.persona_catalog pc on pc.persona_code=pa.persona_code and pc.active
      where ap.user_id=(select auth.uid()) and ap.workspace_id=cm.workspace_id
       and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now()))
  ),'[]'::jsonb)
 ) end;
$function$;

-- Project permission checks consume the same valid active Persona and only Platform-approved Role mappings.
create or replace function private.has_project_permission(p_project_id uuid,p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $function$
 select exists(
  select 1
  from public.projects p
  join public.workspaces w on w.id=p.workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE'
  join public.project_memberships pm on pm.project_id=p.id and pm.workspace_id=p.workspace_id
  join public.company_memberships cm on cm.id=pm.company_membership_id and cm.workspace_id=pm.workspace_id
  join public.project_permission_catalog ppc on ppc.permission_code=p_permission_code and ppc.active
  join public.user_active_persona_contexts ap on ap.user_id=cm.user_id and ap.workspace_id=cm.workspace_id
  join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.workspace_id=cm.workspace_id
   and pa.persona_code=ap.persona_code and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
  join public.persona_catalog persona on persona.persona_code=pa.persona_code and persona.active
  where p.id=p_project_id and p.status='ACTIVE'
   and pm.user_id=(select auth.uid()) and pm.membership_status='ACTIVE'
   and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
   and (not ppc.requires_authority_check or exists(
     select 1 from public.company_membership_authority_assignments aa
     where aa.company_membership_id=cm.id and aa.project_id=p_project_id and aa.authority_code=p_permission_code
      and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
   ))
   and (
    exists(select 1 from public.project_membership_permissions pp
      where pp.project_membership_id=pm.id and pp.permission_code=p_permission_code)
    or exists(select 1 from public.company_membership_role_assignments ra
      join public.role_catalog rc on rc.role_code=ra.role_code and rc.active
      join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=p_permission_code
       and rp.active and rp.approved_by is not null and rp.approved_at is not null
      where ra.company_membership_id=cm.id and ra.workspace_id=cm.workspace_id
       and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()))
   )
 );
$function$;

create or replace function private.user_has_project_permission(p_user_id uuid,p_project_id uuid,p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $function$
 select exists(
  select 1
  from public.projects p
  join public.workspaces w on w.id=p.workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE'
  join public.project_memberships pm on pm.project_id=p.id and pm.workspace_id=p.workspace_id
  join public.company_memberships cm on cm.id=pm.company_membership_id and cm.workspace_id=pm.workspace_id
  join public.project_permission_catalog ppc on ppc.permission_code=p_permission_code and ppc.active
  join public.user_active_persona_contexts ap on ap.user_id=cm.user_id and ap.workspace_id=cm.workspace_id
  join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.workspace_id=cm.workspace_id
   and pa.persona_code=ap.persona_code and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
  join public.persona_catalog persona on persona.persona_code=pa.persona_code and persona.active
  where cm.user_id=p_user_id and cm.membership_status='ACTIVE'
   and pm.project_id=p_project_id and pm.user_id=p_user_id and pm.membership_status='ACTIVE'
   and p.id=p_project_id and p.status='ACTIVE'
   and (not ppc.requires_authority_check or exists(
     select 1 from public.company_membership_authority_assignments aa
     where aa.company_membership_id=cm.id and aa.project_id=p_project_id and aa.authority_code=p_permission_code
      and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
   ))
   and (
    exists(select 1 from public.project_membership_permissions pp
      where pp.project_membership_id=pm.id and pp.permission_code=p_permission_code)
    or exists(select 1 from public.company_membership_role_assignments ra
      join public.role_catalog rc on rc.role_code=ra.role_code and rc.active
      join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=p_permission_code
       and rp.active and rp.approved_by is not null and rp.approved_at is not null
      where ra.company_membership_id=cm.id and ra.workspace_id=cm.workspace_id
       and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()))
   )
 );
$function$;

commit;

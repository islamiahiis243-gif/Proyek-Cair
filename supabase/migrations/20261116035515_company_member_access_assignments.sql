begin;

create or replace function public.get_company_member_access_assignments(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_workspace_id is null or not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required for this workspace' using errcode='42501'; end if;
  if not exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE') then
    raise exception 'Active Company Workspace not found' using errcode='P0002';
  end if;
  select jsonb_build_object(
    'workspace_id',p_workspace_id,
    'personas',coalesce((select jsonb_agg(jsonb_build_object('code',pc.persona_code,'name',pc.display_name,'description',pc.description) order by pc.sort_order,pc.display_name) from public.persona_catalog pc where pc.active),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(jsonb_build_object('code',rc.role_code,'name',rc.display_name,'description',rc.description,
      'approved_permission_codes',coalesce((select jsonb_agg(rp.permission_code order by rp.permission_code)
        from public.role_permission_catalog rp join public.project_permission_catalog pp on pp.permission_code=rp.permission_code and pp.active
        where rp.role_code=rc.role_code and rp.active and rp.approved_by is not null and rp.approved_at is not null),'[]'::jsonb))
      order by rc.sort_order,rc.display_name) from public.role_catalog rc where rc.active),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'company_membership_id',cm.id,'user_id',cm.user_id,'full_name',coalesce(nullif(trim(pr.full_name),''),'Nama belum tersedia'),'membership_status',cm.membership_status,
      'personas',coalesce((select jsonb_agg(jsonb_build_object('id',pa.id,'code',pa.persona_code,'name',pc.display_name,'starts_at',pa.starts_at,'ends_at',pa.ends_at,'revoked_at',pa.revoked_at,
        'is_active',pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())) order by pa.created_at desc)
        from public.company_membership_persona_assignments pa join public.persona_catalog pc on pc.persona_code=pa.persona_code
        where pa.company_membership_id=cm.id and pa.workspace_id=p_workspace_id),'[]'::jsonb),
      'roles',coalesce((select jsonb_agg(jsonb_build_object('id',ra.id,'code',ra.role_code,'name',rc.display_name,'starts_at',ra.starts_at,'ends_at',ra.ends_at,'revoked_at',ra.revoked_at,
        'is_active',ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()),
        'approved_permission_codes',coalesce((select jsonb_agg(rp.permission_code order by rp.permission_code)
          from public.role_permission_catalog rp join public.project_permission_catalog pp on pp.permission_code=rp.permission_code and pp.active
          where rp.role_code=ra.role_code and rp.active and rp.approved_by is not null and rp.approved_at is not null),'[]'::jsonb))
        order by ra.created_at desc) from public.company_membership_role_assignments ra join public.role_catalog rc on rc.role_code=ra.role_code
        where ra.company_membership_id=cm.id and ra.workspace_id=p_workspace_id),'[]'::jsonb),
      'authorities',coalesce((select jsonb_agg(jsonb_build_object('id',aa.id,'code',aa.authority_code,'name',ac.display_name,'project_id',aa.project_id,'project_code',p.project_code,'project_name',p.name,
        'scope',aa.scope,'max_amount',aa.max_amount,'currency',aa.currency,'starts_at',aa.starts_at,'ends_at',aa.ends_at,'revoked_at',aa.revoked_at,
        'is_active',aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())) order by aa.created_at desc)
        from public.company_membership_authority_assignments aa join public.authority_catalog ac on ac.authority_code=aa.authority_code
        join public.projects p on p.id=aa.project_id and p.workspace_id=aa.workspace_id
        where aa.company_membership_id=cm.id and aa.workspace_id=p_workspace_id),'[]'::jsonb)
    ) order by pr.full_name nulls last,cm.user_id) from public.company_memberships cm left join public.profiles pr on pr.id=cm.user_id
      where cm.workspace_id=p_workspace_id and cm.is_company_super_admin=false),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.assign_company_member_access(
 p_workspace_id uuid,p_company_membership_id uuid,p_assignment_type text,p_code text,
 p_ends_at timestamptz default null,p_reason text default null,p_project_id uuid default null,
 p_scope jsonb default '{}'::jsonb,p_max_amount numeric default null,p_currency text default null
) returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid; v_id uuid;
begin
 v_actor:=(select auth.uid());
 if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required for this workspace' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if p_ends_at is not null and p_ends_at<=now() then raise exception 'Expiry must be in the future'; end if;
 if p_assignment_type not in ('PERSONA','ROLE','AUTHORITY') then raise exception 'Unsupported assignment type'; end if;
 perform 1 from public.company_memberships where id=p_company_membership_id and workspace_id=p_workspace_id and membership_status='ACTIVE' and is_company_super_admin=false for update;
 if not found then raise exception 'Active Company Membership not found in this workspace' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_membership_id::text||':'||p_assignment_type||':'||coalesce(p_code,''),0));
 if p_assignment_type='PERSONA' then
  if p_project_id is not null or p_scope<>'{}'::jsonb or p_max_amount is not null or p_currency is not null then raise exception 'Persona assignment does not accept project or authority limits'; end if;
  if not exists(select 1 from public.persona_catalog where persona_code=p_code and active) then raise exception 'Unknown or inactive Persona'; end if;
  if exists(select 1 from public.company_membership_persona_assignments where company_membership_id=p_company_membership_id and persona_code=p_code and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'An active assignment for this Persona already exists'; end if;
  insert into public.company_membership_persona_assignments(company_membership_id,workspace_id,persona_code,assigned_by,reason,starts_at,ends_at)
  values(p_company_membership_id,p_workspace_id,p_code,v_actor,trim(p_reason),now(),p_ends_at) returning id into v_id;
 elsif p_assignment_type='ROLE' then
  if p_project_id is not null or p_scope<>'{}'::jsonb or p_max_amount is not null or p_currency is not null then raise exception 'Role assignment does not accept project or authority limits'; end if;
  if not exists(select 1 from public.role_catalog where role_code=p_code and active) then raise exception 'Unknown or inactive Role'; end if;
  if exists(select 1 from public.company_membership_role_assignments where company_membership_id=p_company_membership_id and role_code=p_code and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'An active assignment for this Role already exists'; end if;
  insert into public.company_membership_role_assignments(company_membership_id,workspace_id,role_code,assigned_by,reason,starts_at,ends_at)
  values(p_company_membership_id,p_workspace_id,p_code,v_actor,trim(p_reason),now(),p_ends_at) returning id into v_id;
 else
  if p_project_id is null or jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' then raise exception 'Authority requires an explicit Project and object scope'; end if;
  if not exists(select 1 from public.authority_catalog where authority_code=p_code and active) then raise exception 'Unknown or inactive Authority'; end if;
  if not exists(select 1 from public.projects p join public.project_memberships pm on pm.project_id=p.id and pm.workspace_id=p.workspace_id
    where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE' and pm.company_membership_id=p_company_membership_id and pm.membership_status='ACTIVE') then
    raise exception 'Authority requires an active Project Membership in this workspace';
  end if;
  if (p_max_amount is null)<>(p_currency is null) or (p_max_amount is not null and (p_max_amount<0 or p_currency !~ '^[A-Z]{3}$')) then raise exception 'Authority amount and ISO currency must be supplied together'; end if;
  if exists(select 1 from public.company_membership_authority_assignments where company_membership_id=p_company_membership_id and project_id=p_project_id and authority_code=p_code and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'An active Authority assignment already exists for this Project'; end if;
  insert into public.company_membership_authority_assignments(company_membership_id,workspace_id,project_id,authority_code,scope,max_amount,currency,assigned_by,reason,starts_at,ends_at)
  values(p_company_membership_id,p_workspace_id,p_project_id,p_code,coalesce(p_scope,'{}'::jsonb),p_max_amount,p_currency,v_actor,trim(p_reason),now(),p_ends_at) returning id into v_id;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values(v_actor,'COMPANY_MEMBER_ACCESS_ASSIGNED','COMPANY_MEMBER_ACCESS_ASSIGNMENT',v_id::text,
  jsonb_build_object('assignment_type',p_assignment_type,'code',p_code,'company_membership_id',p_company_membership_id,'starts_at',now(),'ends_at',p_ends_at,'reason',trim(p_reason),'permission_grants_added',0),
  p_workspace_id,p_project_id);
 return v_id;
end;
$function$;

create or replace function public.revoke_company_member_access(p_workspace_id uuid,p_assignment_type text,p_assignment_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid; v_membership_id uuid; v_code text; v_project_id uuid;
begin
 v_actor:=(select auth.uid());
 if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required for this workspace' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if p_assignment_type not in ('PERSONA','ROLE','AUTHORITY') then raise exception 'Unsupported assignment type'; end if;
 if p_assignment_type='PERSONA' then
  update public.company_membership_persona_assignments set revoked_at=now() where id=p_assignment_id and workspace_id=p_workspace_id and revoked_at is null returning company_membership_id,persona_code into v_membership_id,v_code;
 elsif p_assignment_type='ROLE' then
  update public.company_membership_role_assignments set revoked_at=now() where id=p_assignment_id and workspace_id=p_workspace_id and revoked_at is null returning company_membership_id,role_code into v_membership_id,v_code;
 else
  update public.company_membership_authority_assignments set revoked_at=now() where id=p_assignment_id and workspace_id=p_workspace_id and revoked_at is null returning company_membership_id,authority_code,project_id into v_membership_id,v_code,v_project_id;
 end if;
 if v_membership_id is null then raise exception 'Assignment not found or already revoked' using errcode='P0002'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values(v_actor,'COMPANY_MEMBER_ACCESS_REVOKED','COMPANY_MEMBER_ACCESS_ASSIGNMENT',p_assignment_id::text,
  jsonb_build_object('assignment_type',p_assignment_type,'code',v_code,'company_membership_id',v_membership_id,'revoked_at',now(),'reason',trim(p_reason)),p_workspace_id,v_project_id);
end;
$function$;

revoke all on function public.get_company_member_access_assignments(uuid) from public,anon;
revoke all on function public.assign_company_member_access(uuid,uuid,text,text,timestamptz,text,uuid,jsonb,numeric,text) from public,anon;
revoke all on function public.revoke_company_member_access(uuid,text,uuid,text) from public,anon;
grant execute on function public.get_company_member_access_assignments(uuid) to authenticated;
grant execute on function public.assign_company_member_access(uuid,uuid,text,text,timestamptz,text,uuid,jsonb,numeric,text) to authenticated;
grant execute on function public.revoke_company_member_access(uuid,text,uuid,text) to authenticated;

commit;

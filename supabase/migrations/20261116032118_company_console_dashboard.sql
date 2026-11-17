-- Tenant-scoped Company Console dashboard aggregates.
-- Exposes counts and sanitized activity metadata only to the active Company Super Admin.
create or replace function public.get_company_console_dashboard(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_company_status text;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if p_workspace_id is null or not private.is_company_super_admin(p_workspace_id) then
    raise exception 'Company Super Admin required for this workspace' using errcode='42501';
  end if;
  select w.company_id into v_company_id from public.workspaces w
   where w.id=p_workspace_id and w.type='COMPANY' and w.status='ACTIVE';
  if v_company_id is null then raise exception 'Active Company Workspace not found' using errcode='P0002'; end if;
  select c.legal_name,c.registration_status into v_company_name,v_company_status
   from public.companies c where c.id=v_company_id;
  if not found then raise exception 'Company not found' using errcode='P0002'; end if;

  select jsonb_build_object(
    'workspace_id',p_workspace_id,'company_id',v_company_id,
    'company_name',v_company_name,'company_status',v_company_status,
    'memberships',jsonb_build_object(
      'total',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id),
      'active',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id and m.membership_status='ACTIVE'),
      'suspended',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id and m.membership_status='SUSPENDED'),
      'revoked',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id and m.membership_status='REVOKED')),
    'invitations',jsonb_build_object(
      'active',(select count(*) from public.rfin_tokens t where t.company_id=v_company_id and t.token_class='RFIN_B' and t.revoked_at is null and t.redeemed_at is null and t.expires_at>now()),
      'expired',(select count(*) from public.rfin_tokens t where t.company_id=v_company_id and t.token_class='RFIN_B' and t.revoked_at is null and t.redeemed_at is null and t.expires_at<=now()),
      'redeemed',(select count(*) from public.rfin_tokens t where t.company_id=v_company_id and t.token_class='RFIN_B' and t.redeemed_at is not null),
      'revoked',(select count(*) from public.rfin_tokens t where t.company_id=v_company_id and t.token_class='RFIN_B' and t.revoked_at is not null)),
    'projects',jsonb_build_object(
      'total',(select count(*) from public.projects p where p.workspace_id=p_workspace_id),
      'active',(select count(*) from public.projects p where p.workspace_id=p_workspace_id and p.status='ACTIVE'),
      'completed',(select count(*) from public.projects p where p.workspace_id=p_workspace_id and p.status='COMPLETED'),
      'archived',(select count(*) from public.projects p where p.workspace_id=p_workspace_id and p.status='ARCHIVED')),
    'approvals',jsonb_build_object(
      'pending',(select count(*) from public.workflow_instances wi where wi.workspace_id=p_workspace_id and wi.status in ('ACTIVE','PENDING'))),
    'documents',jsonb_build_object(
      'total',(select count(*) from public.documents d where d.workspace_id=p_workspace_id),
      'by_status',coalesce((select jsonb_object_agg(s.status_key,s.total) from (
        select coalesce(nullif(d.lifecycle_status,''),nullif(d.status,''),'UNKNOWN') status_key,count(*) total
        from public.documents d where d.workspace_id=p_workspace_id
        group by coalesce(nullif(d.lifecycle_status,''),nullif(d.status,''),'UNKNOWN')) s),'{}'::jsonb)),
    'access_alerts',jsonb_build_object(
      'suspended_memberships',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id and m.membership_status='SUSPENDED'),
      'revoked_memberships',(select count(*) from public.company_memberships m where m.workspace_id=p_workspace_id and m.membership_status='REVOKED'),
      'expired_invitations',(select count(*) from public.rfin_tokens t where t.company_id=v_company_id and t.token_class='RFIN_B' and t.revoked_at is null and t.redeemed_at is null and t.expires_at<=now())),
    'last_activity_at',(select max(l.created_at) from public.audit_logs l where l.workspace_id=p_workspace_id),
    'recent_activity',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'entity_type',a.entity_type,'created_at',a.created_at) order by a.created_at desc)
      from (select l.action,l.entity_type,l.created_at from public.audit_logs l where l.workspace_id=p_workspace_id order by l.created_at desc,l.id desc limit 5) a),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_company_console_dashboard(uuid) from public,anon;
grant execute on function public.get_company_console_dashboard(uuid) to authenticated;

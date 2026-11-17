-- Forward reconciliation for post-application changes to 20261116004500.
-- The 00:45 migration is restored to the exact originally committed/applied contents.
-- This migration contains the real delta for SSOT Persona, Role, Authority, RFIN-B,
-- active context, project authorization, workflow, scoped import, and procurement.
begin;

-- SSOT §5.2.1: Final Signatory is authorized by active Company Membership plus explicit appointment.
update public.project_permission_catalog
set requires_authority_check=false,
 description='Final signing is authorized by active Company Membership and explicit Project/document-type Final Signatory appointment; no separate Authority is required'
where permission_code='document.sign';
update public.authority_catalog set active=false where authority_code='document.sign';

-- Idempotent step actions: retries of the same command return the original event.
alter table public.workflow_events add column if not exists idempotency_key uuid;
create unique index if not exists workflow_events_idempotency_uq
 on public.workflow_events(workflow_id,idempotency_key) where idempotency_key is not null;

-- SSOT §5.2.1: Final signing is based on active Company Membership plus explicit
-- Project/document-type appointment; document.sign is a separate permission, not Authority-gated.
update public.project_permission_catalog
set requires_authority_check=false,
 description='Final document signing permission; active Company Membership and explicit Project/document-type Final Signatory appointment are enforced separately'
where permission_code='document.sign';

-- SSOT §18.2 workflow definition permissions (separate from step approval permissions).
insert into public.project_permission_catalog(permission_code,module,action,risk_level,requires_authority_check,active,description)
values
 ('workflow.definition.create','workflow','definition.create','MEDIUM',false,true,'Membuat versi baru definisi workflow pada Project'),
 ('workflow.definition.update','workflow','definition.update','MEDIUM',false,true,'Memperbarui konfigurasi dengan menerbitkan versi baru definisi workflow'),
 ('workflow.escalation.read','workflow','escalation.read','LOW',false,true,'Melihat riwayat reminder dan eskalasi workflow')
on conflict(permission_code) do update set
 module=excluded.module,action=excluded.action,risk_level=excluded.risk_level,
 requires_authority_check=excluded.requires_authority_check,active=true,description=excluded.description;

-- New tables
create table if not exists public.procurement_vendors (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 vendor_name text not null,contact_name text,phone text,email text,npwp_last4 text,active boolean not null default true,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(workspace_id,vendor_name)
);

create table if not exists public.procurement_requests (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),request_no text not null,status text not null default 'DRAFT'
 check(status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','ORDERED','CANCELLED')),
 vendor_id uuid references public.procurement_vendors(id),supplier_name text not null,currency text not null default 'IDR',
 needed_by date,requested_by uuid not null references auth.users(id),notes text,submitted_at timestamptz,approved_at timestamptz,idempotency_key uuid,request_hash text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(project_id,request_no)
);

alter table public.procurement_requests add column if not exists idempotency_key uuid;
alter table public.procurement_requests add column if not exists request_hash text;
create unique index if not exists procurement_requests_idempotency_idx on public.procurement_requests(project_id,idempotency_key) where idempotency_key is not null;

create table if not exists public.procurement_request_items (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.procurement_requests(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id),project_id uuid not null references public.projects(id),
 item_id uuid not null references public.boq_items(id),description text not null,quantity numeric(20,4) not null check(quantity>0),
 uom text not null,unit_price numeric(20,2) not null check(unit_price>=0),created_at timestamptz not null default now()
);

create table if not exists public.procurement_orders (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),request_id uuid not null references public.procurement_requests(id),
 po_no text not null,status text not null default 'ISSUED' check(status in ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
 supplier_name text not null,currency text not null,total_amount numeric(20,2) not null check(total_amount>=0),
 issued_by uuid not null references auth.users(id),issued_at timestamptz not null default now(),
 created_at timestamptz not null default now(),unique(project_id,po_no),unique(request_id)
);

create table if not exists public.procurement_order_items (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.procurement_orders(id),
 workspace_id uuid not null references public.workspaces(id),project_id uuid not null references public.projects(id),
 request_item_id uuid not null references public.procurement_request_items(id),item_id uuid not null references public.boq_items(id),
 description text not null,ordered_quantity numeric(20,4) not null check(ordered_quantity>0),received_quantity numeric(20,4) not null default 0 check(received_quantity>=0),
 uom text not null,unit_price numeric(20,2) not null check(unit_price>=0)
);

create table if not exists public.goods_receipts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),order_id uuid not null references public.procurement_orders(id),
 receipt_no text not null,status text not null default 'RECEIVED' check(status in ('RECEIVED','REJECTED','VOID')),
 received_by uuid not null references auth.users(id),received_at timestamptz not null default now(),reference_no text,notes text,idempotency_key uuid,request_hash text,
 created_at timestamptz not null default now(),unique(project_id,receipt_no)
);

alter table public.goods_receipts add column if not exists idempotency_key uuid;
alter table public.goods_receipts add column if not exists request_hash text;
create unique index if not exists goods_receipts_idempotency_idx on public.goods_receipts(project_id,idempotency_key) where idempotency_key is not null;

create table if not exists public.goods_receipt_items (
 id uuid primary key default gen_random_uuid(),receipt_id uuid not null references public.goods_receipts(id),
 order_item_id uuid not null references public.procurement_order_items(id),item_id uuid not null references public.boq_items(id),
 accepted_quantity numeric(20,4) not null check(accepted_quantity>=0),rejected_quantity numeric(20,4) not null default 0 check(rejected_quantity>=0),
 uom text not null
);

create table if not exists public.user_notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 workspace_id uuid references public.workspaces(id),project_id uuid references public.projects(id),
 notification_type text not null,title text not null,body text not null,reference_type text,reference_id uuid,
 read_at timestamptz,created_at timestamptz not null default now()
);

create table if not exists public.workflow_step_delegations (
 id uuid primary key default gen_random_uuid(),workflow_id uuid not null references public.workflow_instances(id),
 step_id uuid not null references public.workflow_steps(id),delegator_user_id uuid not null references auth.users(id),
 delegate_user_id uuid not null references auth.users(id),starts_at timestamptz not null,ends_at timestamptz not null,
 reason text not null,status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED','EXPIRED')),
 created_at timestamptz not null default now(),check(ends_at>starts_at),check(ends_at<=starts_at+interval '30 days')
);

create table if not exists public.cash_transaction_reversals (
 id uuid primary key default gen_random_uuid(),original_transaction_id uuid not null references public.cash_transactions(id),
 reversal_transaction_id uuid not null references public.cash_transactions(id),reason text not null,reversed_by uuid not null references auth.users(id),
 workspace_id uuid not null references public.workspaces(id),project_id uuid not null references public.projects(id),
 created_at timestamptz not null default now(),unique(original_transaction_id),unique(reversal_transaction_id)
);

create table if not exists public.user_active_persona_contexts (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 persona_code text not null references public.persona_catalog(persona_code),
 updated_at timestamptz not null default now(),
 primary key(user_id,workspace_id)
);

-- Tenant-managed business calendar
create table if not exists public.workspace_business_holidays (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 holiday_date date not null,
 label text not null check(length(trim(label)) between 2 and 160),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,holiday_date)
);

-- Additive columns, constraints and RLS activation
alter table public.project_signatory_appointments add column if not exists revoked_at timestamptz;
alter table public.project_signatory_appointments add column if not exists revoked_by uuid references auth.users(id);
alter table public.project_signatory_appointments add column if not exists revocation_reason text;
alter table public.workflow_instances add column if not exists authority_amount numeric(20,2);
alter table public.workflow_instances add column if not exists authority_currency text;
alter table public.workflow_instances add column if not exists authority_scope jsonb not null default '{}'::jsonb;
alter table public.document_signatures drop constraint if exists document_signatures_authority_level_check;
alter table public.document_signatures alter column authority_level drop not null;
alter table public.user_active_persona_contexts enable row level security;
alter table public.workspace_business_holidays enable row level security;
alter table public.procurement_vendors enable row level security;
alter table public.procurement_requests enable row level security;
alter table public.procurement_request_items enable row level security;
alter table public.procurement_orders enable row level security;
alter table public.procurement_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.user_notifications enable row level security;
alter table public.workflow_step_delegations enable row level security;
alter table public.cash_transaction_reversals enable row level security;

-- Additive indexes
create unique index if not exists user_notifications_reference_uq on public.user_notifications(user_id,notification_type,reference_id) where reference_id is not null;

-- Final definitions of new or changed server-side functions
create or replace function private.has_project_authority(
 p_project_id uuid,p_authority_code text,p_amount numeric default null,p_currency text default null,p_scope jsonb default '{}'::jsonb
) returns boolean
language sql stable security definer set search_path=''
as $$
 select exists(
  select 1
  from public.project_memberships pm
  join public.company_membership_authority_assignments aa
    on aa.company_membership_id=pm.company_membership_id
   and aa.project_id=pm.project_id
   and aa.workspace_id=pm.workspace_id
  join public.authority_catalog ac on ac.authority_code=aa.authority_code and ac.active
  where pm.project_id=p_project_id and pm.user_id=(select auth.uid()) and pm.membership_status='ACTIVE'
    and aa.authority_code=p_authority_code and aa.revoked_at is null
    and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
    and (aa.max_amount is null or (p_amount is not null and aa.max_amount>=p_amount and aa.currency=p_currency))
    and (aa.scope='{}'::jsonb or (p_scope is not null and p_scope<>'{}'::jsonb and p_scope @> aa.scope))
 );
$$;

-- The 20261116004500 API exposed a six-column OUT record. This revision adds
-- is_company_super_admin, which PostgreSQL cannot change with CREATE OR REPLACE.
-- Drop the invoker wrapper first (it depends on the private implementation), then
-- recreate both signatures with the matching seven-column result below.
drop function if exists public.list_company_members_for_console(uuid);
drop function if exists private.list_company_members_for_console(uuid);

create or replace function private.list_company_members_for_console(p_workspace_id uuid)
returns table(membership_id uuid,user_id uuid,email text,full_name text,membership_status text,activated_at timestamptz,is_company_super_admin boolean)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.is_company_super_admin(p_workspace_id) then raise exception 'Active Company Super Admin required'; end if;
 return query
 select m.id,m.user_id,u.email,coalesce(p.full_name,''),m.membership_status,m.activated_at,m.is_company_super_admin
 from public.company_memberships m
 join auth.users u on u.id=m.user_id
 left join public.profiles p on p.id=m.user_id
 where m.workspace_id=p_workspace_id
 order by lower(coalesce(p.full_name,u.email)),u.email;
end $$;

create or replace function public.list_company_members_for_console(p_workspace_id uuid)
returns table(membership_id uuid,user_id uuid,email text,full_name text,membership_status text,activated_at timestamptz,is_company_super_admin boolean)
language sql stable security invoker set search_path=''
as $$ select * from private.list_company_members_for_console(p_workspace_id); $$;
revoke all on function public.list_company_members_for_console(uuid) from public,anon;
grant execute on function public.list_company_members_for_console(uuid) to authenticated;

create or replace function private.issue_rfin_b_with_snapshot(
 p_company_id uuid,p_recipient_email text,p_snapshot jsonb,p_expires_in interval default interval '7 days',p_reason text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_workspace uuid; v_code text; v_token_id uuid; v_email text; v_project jsonb; v_auth jsonb; v_permission text;v_signatory_only boolean;
begin
 select w.id into v_workspace from public.workspaces w
 where w.company_id=p_company_id and w.workspace_type='COMPANY' and w.status='ACTIVE';
 if v_workspace is null or not private.is_company_super_admin(v_workspace) then raise exception 'Active Company Super Admin required'; end if;
 v_email:=lower(trim(coalesce(p_recipient_email,'')));
 if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'Recipient email is invalid'; end if;
  if exists(select 1 from public.company_memberships cm join auth.users u on u.id=cm.user_id where cm.company_id=p_company_id and lower(u.email)=v_email) then raise exception 'Recipient already has a Company Membership; use Penugasan Anggota to replace or reactivate access'; end if;
 if p_expires_in<=interval '0' or p_expires_in>interval '14 days' then raise exception 'Expiry must be 1-14 days'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'schema_version' is distinct from '1' then raise exception 'RFIN-B snapshot schema version 1 required'; end if;
  if jsonb_typeof(p_snapshot->'persona_codes') is distinct from 'array' then raise exception 'Persona codes must be an array'; end if;
   if jsonb_typeof(p_snapshot->'role_codes') is distinct from 'array' then raise exception 'Role codes must be an array'; end if;
  if jsonb_typeof(p_snapshot->'project_assignments') is distinct from 'array' then raise exception 'Project assignments must be an array'; end if;
  if jsonb_typeof(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) is distinct from 'array' then raise exception 'Authority scope must be an array'; end if;
  v_signatory_only:=jsonb_array_length(p_snapshot->'persona_codes')=0 and jsonb_array_length(p_snapshot->'project_assignments')=0;
   if v_signatory_only then
    if jsonb_array_length(coalesce(p_snapshot->'role_codes','[]'::jsonb))>0
     or jsonb_array_length(coalesce(p_snapshot->'authority_scopes','[]'::jsonb))>0 then
     raise exception 'Final Signatory-only membership is Company Membership only: no Role, Persona, Project Membership or Authority assignment';
    end if;
   elsif jsonb_array_length(p_snapshot->'persona_codes')<1 or jsonb_array_length(p_snapshot->'project_assignments')<1
    or jsonb_array_length(p_snapshot->'role_codes')<1 then
    raise exception 'Standard RFIN-B access requires Persona, Role and Project assignments';
   end if;
 if jsonb_array_length(p_snapshot->'persona_codes')>10 or jsonb_array_length(p_snapshot->'role_codes')>8 or jsonb_array_length(p_snapshot->'project_assignments')>50 or jsonb_array_length(coalesce(p_snapshot->'authority_scopes','[]'::jsonb))>100 then raise exception 'RFIN-B snapshot selection limit exceeded'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'persona_codes') x(code) group by code having count(*)>1)
 or exists(select 1 from jsonb_array_elements_text(p_snapshot->'role_codes') x(code) group by code having count(*)>1) then raise exception 'Duplicate Persona or Role selection'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'persona_codes') x(code) where not exists(select 1 from public.persona_catalog pc where pc.persona_code=x.code and pc.active)) then raise exception 'Unknown or inactive Persona'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'role_codes') x(code) where not exists(select 1 from public.role_catalog rc where rc.role_code=x.code and rc.active)) then raise exception 'Unknown or inactive Role'; end if;
 for v_project in select value from jsonb_array_elements(p_snapshot->'project_assignments') loop
  if nullif(v_project->>'project_id','') is null or jsonb_typeof(v_project->'permission_codes') is distinct from 'array' then raise exception 'Every Project needs a permission array'; end if;
  if jsonb_array_length(v_project->'permission_codes')=0 and not exists(select 1 from public.role_permission_catalog rp where rp.active and rp.role_code=any(array(select jsonb_array_elements_text(p_snapshot->'role_codes')))) then raise exception 'Project requires at least one direct or approved Role permission'; end if;
  if not exists(select 1 from public.projects pr where pr.id=(v_project->>'project_id')::uuid and pr.workspace_id=v_workspace and pr.status='ACTIVE') then raise exception 'Project is not active in the target Company Workspace'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_project->'permission_codes') pc(code) where not exists(select 1 from public.project_permission_catalog c where c.permission_code=pc.code and c.active)) then raise exception 'Unknown or inactive Project permission'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_project->'permission_codes') pc(code) group by code having count(*)>1) then raise exception 'Duplicate Project permission'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_project->'permission_codes') pc(code)
    join public.project_permission_catalog c on c.permission_code=pc.code
    where c.requires_authority_check and not exists(
      select 1 from jsonb_array_elements(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) a
      where a->>'project_id'=v_project->>'project_id' and a->>'authority_code'=pc.code
    )) or exists(
      select 1 from public.role_permission_catalog rp join public.project_permission_catalog c on c.permission_code=rp.permission_code and c.requires_authority_check
      where rp.active and rp.role_code=any(array(select jsonb_array_elements_text(p_snapshot->'role_codes')))
       and not exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) a
         where a->>'project_id'=v_project->>'project_id' and a->>'authority_code'=rp.permission_code)
    ) then raise exception 'Authority-gated direct or Role permission requires explicit authority scope for the same Project'; end if;
 end loop;
 for v_auth in select value from jsonb_array_elements(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) loop
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'project_assignments') p where p->>'project_id'=v_auth->>'project_id' and (exists(select 1 from jsonb_array_elements_text(p->'permission_codes') x(code) where x.code=v_auth->>'authority_code') or exists(select 1 from public.role_permission_catalog rp where rp.active and rp.permission_code=v_auth->>'authority_code' and rp.role_code=any(array(select jsonb_array_elements_text(p_snapshot->'role_codes')))))) then raise exception 'Authority is not part of the selected Project permission set'; end if;
  if not exists(select 1 from public.authority_catalog a where a.authority_code=v_auth->>'authority_code' and a.active)
     or not exists(select 1 from jsonb_array_elements(p_snapshot->'project_assignments') p where p->>'project_id'=v_auth->>'project_id')
     or (v_auth ? 'max_amount' and ((v_auth->>'max_amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (v_auth->>'max_amount')::numeric<0))
     or ((v_auth ? 'max_amount') <> (v_auth ? 'currency'))
     or (v_auth ? 'currency' and (v_auth->>'currency') !~ '^[A-Z]{3}$')
     or exists(select 1 from jsonb_object_keys(coalesce(v_auth->'scope','{}'::jsonb)) k where k not in ('transaction_category','document_type','workflow_stage')) then
    raise exception 'Invalid Authority scope, amount, currency or Project binding';
  end if;
 end loop;
 v_code:='RFB-'||upper(encode(extensions.gen_random_bytes(18),'hex'));
 insert into public.rfin_tokens(token_class,token_hash,company_id,recipient_email,issued_by,expires_at,metadata)
 values('RFIN_B',encode(extensions.digest(v_code,'sha256'),'hex'),p_company_id,v_email,(select auth.uid()),now()+p_expires_in,
   jsonb_build_object('schema_version','1','issue_reason',trim(p_reason),'snapshot',p_snapshot))
 returning id into v_token_id;
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v_workspace,'company_membership.rfin_b_issued','rfin_token',v_token_id::text,
  jsonb_build_object('company_id',p_company_id,'recipient_email',v_email,'expires_at',now()+p_expires_in,'reason',trim(p_reason),
   'snapshot_sha256',encode(extensions.digest(p_snapshot::text,'sha256'),'hex'),'token_hash_persisted',true));
 return jsonb_build_object('token_id',v_token_id,'code',v_code,'expires_at',now()+p_expires_in,'snapshot',p_snapshot);
end $$;

create or replace function private.replace_company_member_access(
 p_membership_id uuid,p_persona_codes text[],p_role_codes text[],p_project_assignments jsonb,p_authority_scopes jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_member public.company_memberships; v_project jsonb; v_auth jsonb; v_pm uuid; v_code text; v_workspace uuid; v_permission text;v_signatory_only boolean;
begin
  p_persona_codes:=coalesce(p_persona_codes,'{}'::text[]);
  p_role_codes:=coalesce(p_role_codes,'{}'::text[]);
  p_project_assignments:=coalesce(p_project_assignments,'[]'::jsonb);
  p_authority_scopes:=coalesce(p_authority_scopes,'[]'::jsonb);
 select * into v_member from public.company_memberships where id=p_membership_id for update;
 if not found or not private.is_company_super_admin(v_member.workspace_id) then raise exception 'Active Company Super Admin and Company Membership required'; end if;
 v_workspace:=v_member.workspace_id;
 if v_member.membership_status not in ('ACTIVE','PENDING','SUSPENDED') then raise exception 'Membership lifecycle does not permit access assignment'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
  if jsonb_typeof(p_project_assignments) is distinct from 'array'
   or jsonb_typeof(p_authority_scopes) is distinct from 'array' then raise exception 'Role, Project and Authority assignment arrays are required'; end if;
  v_signatory_only:=coalesce(array_length(p_persona_codes,1),0)=0 and jsonb_array_length(p_project_assignments)=0;
   if v_signatory_only then
    if coalesce(array_length(p_role_codes,1),0)>0 or jsonb_array_length(coalesce(p_authority_scopes,'[]'::jsonb))>0 then
     raise exception 'Final Signatory-only membership is Company Membership only: no Role, Persona, Project Membership or Authority assignment';
    end if;
   elsif coalesce(array_length(p_persona_codes,1),0)<1 or jsonb_array_length(p_project_assignments)<1
    or coalesce(array_length(p_role_codes,1),0)<1 then
    raise exception 'Standard member access requires Persona, Role and Project assignments';
   end if;
 if exists(select 1 from unnest(p_persona_codes) x where not exists(select 1 from public.persona_catalog c where c.persona_code=x and c.active))
 or exists(select 1 from unnest(p_role_codes) x where not exists(select 1 from public.role_catalog c where c.role_code=x and c.active)) then raise exception 'Unknown or inactive Persona/Role'; end if;
 -- Revoke current active assignments without deleting their history.
 update public.company_membership_persona_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 update public.company_membership_role_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 update public.company_membership_authority_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 delete from public.user_active_persona_contexts where user_id=v_member.user_id and workspace_id=v_workspace;
 insert into public.company_membership_persona_assignments(company_membership_id,workspace_id,persona_code,assigned_by,reason)
 select p_membership_id,v_workspace,x,(select auth.uid()),trim(p_reason) from unnest(p_persona_codes) x;
 insert into public.company_membership_role_assignments(company_membership_id,workspace_id,role_code,assigned_by,reason)
 select p_membership_id,v_workspace,x,(select auth.uid()),trim(p_reason) from unnest(p_role_codes) x;
 -- Revoke any previous Project Membership omitted from the new assignment snapshot.
 update public.project_memberships pm set membership_status='REVOKED',updated_at=now()
 where pm.company_membership_id=p_membership_id and pm.membership_status='ACTIVE'
   and not exists(select 1 from jsonb_array_elements(p_project_assignments) p where p->>'project_id'=pm.project_id::text);
 delete from public.project_membership_permissions pp using public.project_memberships pm
 where pp.project_membership_id=pm.id and pm.company_membership_id=p_membership_id and pm.membership_status='REVOKED';
 -- Replace permissions for every Project explicitly included in this assignment payload.
 for v_project in select value from jsonb_array_elements(p_project_assignments) loop
  if not exists(select 1 from public.projects p where p.id=(v_project->>'project_id')::uuid and p.workspace_id=v_workspace and p.status='ACTIVE') then raise exception 'Project outside Company Workspace or inactive'; end if;
  if jsonb_typeof(v_project->'permission_codes')<>'array' then raise exception 'Project permission list is required'; end if;
  if jsonb_array_length(v_project->'permission_codes')=0 and not exists(select 1 from public.role_permission_catalog rp where rp.active and rp.role_code=any(p_role_codes)) then raise exception 'Project requires direct or approved Role permissions'; end if;
  insert into public.project_memberships(project_id,workspace_id,company_membership_id,user_id,assigned_by,membership_status)
  values((v_project->>'project_id')::uuid,v_workspace,p_membership,v_member.user_id,(select auth.uid()),'ACTIVE')
  on conflict(project_id,company_membership_id) do update set membership_status='ACTIVE',assigned_by=excluded.assigned_by,updated_at=now()
  returning id into v_pm;
  delete from public.project_membership_permissions where project_membership_id=v_pm;
  for v_code in select jsonb_array_elements_text(v_project->'permission_codes') loop
   if not exists(select 1 from public.project_permission_catalog c where c.permission_code=v_code and c.active) then raise exception 'Unknown or inactive Project permission'; end if;
   if exists(select 1 from public.project_permission_catalog c where c.permission_code=v_code and c.requires_authority_check)
      and not exists(select 1 from jsonb_array_elements(coalesce(p_authority_scopes,'[]'::jsonb)) a where a->>'project_id'=v_project->>'project_id' and a->>'authority_code'=v_code) then
    raise exception 'Authority-gated permission needs a matching Authority assignment';
   end if;
   insert into public.project_membership_permissions(project_membership_id,permission_code,granted_by) values(v_pm,v_code,(select auth.uid()));
  end loop;
 end loop;
 for v_project in select value from jsonb_array_elements(p_project_assignments) loop
  for v_permission in select rp.permission_code from public.role_permission_catalog rp join public.project_permission_catalog pc on pc.permission_code=rp.permission_code and pc.requires_authority_check
   where rp.active and rp.role_code=any(p_role_codes) loop
   if not exists(select 1 from jsonb_array_elements(coalesce(p_authority_scopes,'[]'::jsonb)) a
    where a->>'project_id'=v_project->>'project_id' and a->>'authority_code'=v_permission) then
    raise exception 'Role-derived authority-gated permission requires an explicit Authority scope for the same Project';
   end if;
  end loop;
 end loop;
 for v_auth in select value from jsonb_array_elements(coalesce(p_authority_scopes,'[]'::jsonb)) loop
  if not exists(select 1 from public.authority_catalog a where a.authority_code=v_auth->>'authority_code' and a.active)
     or not exists(select 1 from jsonb_array_elements(p_project_assignments) p where p->>'project_id'=v_auth->>'project_id')
     or jsonb_typeof(coalesce(v_auth->'scope','{}'::jsonb)) is distinct from 'object'
     or ((v_auth ? 'max_amount') <> (v_auth ? 'currency'))
     or (v_auth ? 'max_amount' and ((v_auth->>'max_amount') !~ '^[0-9]+([.][0-9]{1,2})?$' or (v_auth->>'max_amount')::numeric<0))
     or (v_auth ? 'currency' and (v_auth->>'currency') !~ '^[A-Z]{3}$') then
    raise exception 'Authority scope, amount and currency are invalid';
   end if;
  insert into public.company_membership_authority_assignments(company_membership_id,workspace_id,project_id,authority_code,scope,max_amount,currency,assigned_by,reason)
  values(p_membership_id,v_workspace,(v_auth->>'project_id')::uuid,v_auth->>'authority_code',coalesce(v_auth->'scope','{}'::jsonb),
   nullif(v_auth->>'max_amount','')::numeric,nullif(v_auth->>'currency',''),(select auth.uid()),trim(p_reason));
 end loop;
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v_workspace,'company_membership.access_replaced','company_membership',p_membership_id::text,
  jsonb_build_object('reason',trim(p_reason),'persona_codes',p_persona_codes,'role_codes',p_role_codes,
   'project_assignments',p_project_assignments,'authority_scopes',coalesce(p_authority_scopes,'[]'::jsonb)));
 return jsonb_build_object('membership_id',p_membership_id,'persona_codes',p_persona_codes,'role_codes',p_role_codes);
end $$;

create or replace function private.can_read_workflow(p_workflow_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.workflow_instances w where w.id=p_workflow_id
  and (private.has_project_permission(w.project_id,'workflow.read')
   or private.is_company_super_admin(w.workspace_id)
   or exists(select 1 from public.workflow_steps ws where ws.workflow_id=w.id and ws.assignee_user_id=(select auth.uid()))))
$$;

create or replace function private.user_has_project_permission(p_user_id uuid,p_project_id uuid,p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1
  from public.project_memberships pm
  join public.company_memberships cm on cm.id=pm.company_membership_id
  join public.user_active_persona_contexts ap on ap.user_id=cm.user_id and ap.workspace_id=cm.workspace_id
  join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.persona_code=ap.persona_code
  where cm.user_id=p_user_id and cm.membership_status='ACTIVE'
   and pm.project_id=p_project_id and pm.membership_status='ACTIVE'
   and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
   and (
    exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code=p_permission_code)
    or exists(select 1 from public.company_membership_role_assignments ra
      join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=p_permission_code and rp.active
      where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()))
   )
 );
$$;
revoke all on function private.user_has_project_permission(uuid,uuid,text) from public,anon,authenticated;


create or replace function private.workflow_resource_snapshot(
 p_project_id uuid,p_resource_type text,p_resource_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $wfbody1$
declare v_snapshot jsonb;
begin
 -- Lock the canonical resource (and mutable child rows) so an approval decision
 -- cannot race a concurrent edit between freshness validation and commit.
 if p_resource_type='CASH' then
  perform 1 from public.cash_transactions where id=p_resource_id and project_id=p_project_id for update;
  select to_jsonb(ct) into v_snapshot from public.cash_transactions ct where ct.id=p_resource_id and ct.project_id=p_project_id;
 elsif p_resource_type='PROCUREMENT' then
  perform 1 from public.procurement_requests where id=p_resource_id and project_id=p_project_id for update;
  perform 1 from public.procurement_request_items where request_id=p_resource_id and project_id=p_project_id for update;
  perform 1 from public.boq_items bi where bi.project_id=p_project_id and bi.id in
   (select ri.item_id from public.procurement_request_items ri where ri.request_id=p_resource_id and ri.project_id=p_project_id) for update;
  select jsonb_build_object('resource',to_jsonb(r),'items',
   coalesce((select jsonb_agg(jsonb_build_object('line',to_jsonb(ri),'boq_item',to_jsonb(bi)) order by ri.id)
    from public.procurement_request_items ri join public.boq_items bi on bi.id=ri.item_id and bi.project_id=p_project_id
    where ri.request_id=r.id and ri.project_id=p_project_id),'[]'::jsonb))
  into v_snapshot from public.procurement_requests r where r.id=p_resource_id and r.project_id=p_project_id;
 elsif p_resource_type='BOQ' then
  perform 1 from public.boq_additions where id=p_resource_id and project_id=p_project_id for update;
  select jsonb_build_object('resource_type','BOQ_ADDITION','resource',to_jsonb(ba)) into v_snapshot
   from public.boq_additions ba where ba.id=p_resource_id and ba.project_id=p_project_id;
  if v_snapshot is null then
   perform 1 from public.boq_items where id=p_resource_id and project_id=p_project_id for update;
   select jsonb_build_object('resource_type','BOQ_ITEM','resource',to_jsonb(bi)) into v_snapshot
    from public.boq_items bi where bi.id=p_resource_id and bi.project_id=p_project_id;
  end if;
 elsif p_resource_type='INVENTORY' then
  perform 1 from public.inventory_transactions where id=p_resource_id and project_id=p_project_id for update;
  perform 1 from public.boq_items bi where bi.project_id=p_project_id and bi.id=(select it.item_id from public.inventory_transactions it where it.id=p_resource_id and it.project_id=p_project_id) for update;
  select jsonb_build_object('resource',to_jsonb(it),'boq_item',to_jsonb(bi)) into v_snapshot
   from public.inventory_transactions it join public.boq_items bi on bi.id=it.item_id and bi.project_id=p_project_id
   where it.id=p_resource_id and it.project_id=p_project_id;
 elsif p_resource_type='DOCUMENT' then
  perform 1 from public.documents where id=p_resource_id and project_id=p_project_id for update;
  select to_jsonb(d) into v_snapshot from public.documents d where d.id=p_resource_id and d.project_id=p_project_id;
 elsif p_resource_type='PROGRESS' then
  perform 1 from public.progress_logs where id=p_resource_id and project_id=p_project_id for update;
  select to_jsonb(p) into v_snapshot from public.progress_logs p where p.id=p_resource_id and p.project_id=p_project_id;
 elsif p_resource_type='K3' then
  perform 1 from public.safety_reports where id=p_resource_id and project_id=p_project_id for update;
  select to_jsonb(sr) into v_snapshot from public.safety_reports sr where sr.id=p_resource_id and sr.project_id=p_project_id;
 else
  raise exception 'Unsupported workflow resource type';
 end if;
 return v_snapshot;
end $wfbody1$;

create or replace function private.has_company_member_permission(
 p_membership_id uuid,p_project_id uuid,p_permission_code text
) returns boolean language sql stable security definer set search_path=''
as $wfbody2$
 select exists(
  select 1 from public.company_memberships cm
  join public.projects p on p.id=p_project_id and p.workspace_id=cm.workspace_id and p.status='ACTIVE'
  where cm.id=p_membership_id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
   and exists(select 1 from public.project_permission_catalog pc where pc.permission_code=p_permission_code and pc.active)
   and (
    exists(select 1 from public.project_memberships pm join public.project_membership_permissions pp on pp.project_membership_id=pm.id
     where pm.company_membership_id=cm.id and pm.project_id=p_project_id and pm.membership_status='ACTIVE' and pp.permission_code=p_permission_code)
    or exists(select 1 from public.company_membership_role_assignments ra
     join public.role_catalog rc on rc.role_code=ra.role_code and rc.active
     join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=p_permission_code and rp.active
     where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()))
   )
 );
 $wfbody2$;

create or replace function private.start_project_workflow(
 p_project_id uuid,p_process_type text,p_resource_type text,p_resource_id uuid,p_resource_version text,
 p_approver_ids uuid[],p_permission_code text,p_authority_code text,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $wfbody2$
declare
 v_project public.projects;v_company uuid;v_workspace uuid;v_id uuid;v_step integer:=1;v_user uuid;v_due timestamptz;
 v_existing public.workflow_instances;v_amount numeric;v_currency text:='IDR';v_scope jsonb:='{}'::jsonb;v_requires_authority boolean;v_effective_authority_code text;v_resource_snapshot jsonb;v_resource_hash text;
begin
 select p.* into v_project from public.projects p where p.id=p_project_id and p.status='ACTIVE';
 if not found or not private.has_project_permission(p_project_id,'workflow.start') then raise exception 'Workflow start permission required'; end if;
 if p_resource_type not in ('BOQ','PROGRESS','PROCUREMENT','INVENTORY','CASH','K3','DOCUMENT') or p_resource_id is null then raise exception 'Unsupported workflow resource'; end if;
 if p_idempotency_key is null then raise exception 'Workflow start idempotency key is required'; end if;
 if coalesce(array_length(p_approver_ids,1),0)<1 or array_length(p_approver_ids,1)>20 then raise exception 'Approver chain must contain 1-20 users'; end if;
 if p_permission_code not in ('boq.review','boq.approve','progress.review','progress.verify','progress.approve','procurement.review','procurement.approve','inventory.movement.review','inventory.movement.approve','cash.transaction.review','cash.transaction.approve','k3.report.review','k3.report.close','document.review','document.approve') then raise exception 'Invalid workflow action permission'; end if;
 select requires_authority_check into v_requires_authority from public.project_permission_catalog where permission_code=p_permission_code and active;
 if not found then raise exception 'Workflow action permission is inactive'; end if;
 if v_requires_authority and p_authority_code is distinct from p_permission_code then raise exception 'Authority-gated workflow permission requires matching authority code'; end if;
 v_effective_authority_code:=case when v_requires_authority then p_permission_code else null end;
 if p_authority_code is not null and p_authority_code is distinct from p_permission_code then raise exception 'Authority code must match the workflow action permission'; end if;
 if exists(select 1 from unnest(p_approver_ids) with ordinality a(user_id,ord) group by user_id having count(*)>1) then raise exception 'Duplicate approver in serial chain'; end if;
 select w.company_id,w.id into v_company,v_workspace from public.workspaces w where w.id=v_project.workspace_id;

 -- Capture immutable resource facts before creating the approval chain.
 if p_resource_type='CASH' then
  select ct.amount, 'IDR', jsonb_build_object('transaction_category',coalesce(ct.category,ct.transaction_type),'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.cash_transactions ct where ct.id=p_resource_id and ct.project_id=p_project_id;
 elsif p_resource_type='PROCUREMENT' then
  select coalesce(sum(ri.quantity*ri.unit_price),0),r.currency,
   jsonb_build_object('transaction_category','PROCUREMENT','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope
   from public.procurement_requests r left join public.procurement_request_items ri on ri.request_id=r.id
   where r.id=p_resource_id and r.project_id=p_project_id group by r.id;
 elsif p_resource_type='BOQ' then
  select ba.quantity*ba.unit_rate,'IDR',jsonb_build_object('transaction_category','BOQ_ADDITION','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.boq_additions ba where ba.id=p_resource_id and ba.project_id=p_project_id;
  if not found then
   select bi.quantity*coalesce(bi.baseline_unit_rate,bi.unit_rate),'IDR',
    jsonb_build_object('transaction_category','BOQ','workflow_stage','APPROVAL')
    into v_amount,v_currency,v_scope from public.boq_items bi where bi.id=p_resource_id and bi.project_id=p_project_id;
  end if;
 elsif p_resource_type='INVENTORY' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category',it.transaction_type,'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.inventory_transactions it
   where it.id=p_resource_id and it.project_id=p_project_id;
 elsif p_resource_type='DOCUMENT' then
  select d.amount_summary,'IDR',jsonb_build_object('document_type',d.document_type,'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.documents d where d.id=p_resource_id and d.project_id=p_project_id;
 elsif p_resource_type='PROGRESS' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category','PROGRESS','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.progress_logs p where p.id=p_resource_id and p.project_id=p_project_id;
 elsif p_resource_type='K3' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category',coalesce(sr.report_type,'K3'),'workflow_stage','REVIEW')
   into v_amount,v_currency,v_scope from public.safety_reports sr where sr.id=p_resource_id and sr.project_id=p_project_id;
 end if;
 if not found then raise exception 'Workflow resource does not exist in the selected Project'; end if;
 v_scope:=coalesce(v_scope,'{}'::jsonb);
 v_resource_snapshot:=private.workflow_resource_snapshot(p_project_id,p_resource_type,p_resource_id);
 if v_resource_snapshot is null then raise exception 'Workflow resource disappeared or is outside the selected Project'; end if;
 v_resource_hash:=encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex');

 if exists(select 1 from unnest(p_approver_ids) u(user_id)
  where not private.user_has_project_permission(u.user_id,p_project_id,p_permission_code)
     or not private.user_has_project_permission(u.user_id,p_project_id,'workflow.step.act')) then
  raise exception 'Every approver needs active Company/Project membership, active Persona, action permission and workflow.step.act';
 end if;
 if v_effective_authority_code is not null and exists(
  select 1 from unnest(p_approver_ids) u(user_id)
  join public.project_memberships pm on pm.project_id=p_project_id and pm.user_id=u.user_id and pm.membership_status='ACTIVE'
  join public.company_memberships cm on cm.id=pm.company_membership_id and cm.membership_status='ACTIVE'
  where not exists(select 1 from public.company_membership_authority_assignments aa
   where aa.company_membership_id=cm.id and aa.project_id=p_project_id and aa.authority_code=v_effective_authority_code
    and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
    and (aa.max_amount is null or (v_amount is not null and aa.max_amount>=v_amount and aa.currency=v_currency))
    and (aa.scope='{}'::jsonb or v_scope @> aa.scope))
 ) then raise exception 'Every approver needs active matching Authority and sufficient amount/scope limit'; end if;
 if (select auth.uid())=any(p_approver_ids) and p_process_type in ('CASH','DOCUMENT') then raise exception 'Self approval is prohibited for cash and formal documents'; end if;

 insert into public.workflow_instances(company_id,workspace_id,project_id,process_type,resource_type,resource_id,resource_version,
  initiated_by,idempotency_key,authority_amount,authority_currency,authority_scope,snapshot)
 values(v_company,v_workspace,p_project_id,p_process_type,p_resource_type,p_resource_id,v_resource_hash,
  (select auth.uid()),p_idempotency_key,v_amount,v_currency,v_scope,
  jsonb_build_object('approvers',p_approver_ids,'permission_code',p_permission_code,'authority_code',v_effective_authority_code,
   'authority_amount',v_amount,'authority_currency',v_currency,'authority_scope',v_scope,'timezone','Asia/Jakarta',
   'resource_snapshot',v_resource_snapshot,'client_resource_version',p_resource_version))
 on conflict(project_id,idempotency_key) do nothing returning id into v_id;
 if v_id is null then
  select * into v_existing from public.workflow_instances where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if not found or v_existing.initiated_by is distinct from (select auth.uid())
   or v_existing.process_type is distinct from p_process_type or v_existing.resource_type is distinct from p_resource_type
   or v_existing.resource_id is distinct from p_resource_id or v_existing.resource_version is distinct from v_resource_hash
   or v_existing.snapshot->'approvers' is distinct from to_jsonb(p_approver_ids)
   or v_existing.snapshot->>'permission_code' is distinct from p_permission_code
   or v_existing.snapshot->>'authority_code' is distinct from v_effective_authority_code
   or v_existing.snapshot->>'client_resource_version' is distinct from p_resource_version then
   raise exception 'IDEMPOTENCY_KEY_REUSED: this key already belongs to a different workflow request';
  end if;
  return v_existing.id;
 end if;
 foreach v_user in array p_approver_ids loop
  v_due:=private.add_business_days(now(),2,'Asia/Jakarta',v_workspace);
  insert into public.workflow_steps(workflow_id,step_order,assignee_user_id,permission_code,authority_code,status,due_at)
  values(v_id,v_step,v_user,p_permission_code,v_effective_authority_code,case when v_step=1 then 'ACTIVE' else 'PENDING' end,case when v_step=1 then v_due else null end);
  insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
  values(v_user,v_workspace,p_project_id,
   case when v_step=1 then 'WORKFLOW_STEP_ASSIGNED' else 'WORKFLOW_STEP_SCHEDULED' end,
   case when v_step=1 then 'Tugas approval baru' else 'Tahap approval terjadwal' end,
   case when v_step=1 then 'Anda ditetapkan sebagai approver aktif. Periksa dokumen, scope dan batas kewenangan.'
    else 'Anda termasuk dalam rantai approval serial. Tugas menjadi aktif setelah tahap sebelumnya selesai.' end,
   'workflow',v_id) on conflict do nothing;
  v_step:=v_step+1;
 end loop;
 insert into public.workflow_events(workflow_id,actor_id,event_type,to_status,details)
 values(v_id,(select auth.uid()),'WORKFLOW_STARTED','ACTIVE',jsonb_build_object('approver_count',array_length(p_approver_ids,1),'authority_amount',v_amount,'authority_currency',v_currency,'authority_scope',v_scope));
 return v_id;
end $wfbody2$;

create or replace function private.act_project_workflow_step(
 p_workflow_id uuid,p_step_id uuid,p_action text,p_reason text,p_expected_version integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $wfbody3$
declare
 v_workflow public.workflow_instances;v_step public.workflow_steps;v_next public.workflow_steps;
 v_resource_snapshot jsonb;v_resource_hash text;v_existing_event public.workflow_events;v_event_id uuid;
begin
 if p_idempotency_key is null then raise exception 'Workflow action idempotency key is required'; end if;
 select * into v_workflow from public.workflow_instances where id=p_workflow_id for update;
 if not found then raise exception 'Workflow not found'; end if;
 select * into v_existing_event from public.workflow_events
 where workflow_id=p_workflow_id and idempotency_key=p_idempotency_key;
 if found then
  if v_existing_event.step_id is distinct from p_step_id
   or v_existing_event.actor_id is distinct from (select auth.uid())
   or v_existing_event.event_type is distinct from 'STEP_'||p_action
   or v_existing_event.reason is distinct from nullif(trim(p_reason),'') then
   raise exception 'IDEMPOTENCY_KEY_REUSED: this key already belongs to a different workflow action';
  end if;
  return jsonb_build_object('workflow_id',p_workflow_id,'event_id',v_existing_event.id,'action',p_action,
   'idempotent_replay',true,'current_status',v_workflow.status,'current_version',v_workflow.expected_version);
 end if;
 if p_expected_version is null or v_workflow.status<>'ACTIVE' or v_workflow.expected_version<>p_expected_version then raise exception 'Workflow missing, inactive or stale version'; end if;
 select * into v_step from public.workflow_steps where id=p_step_id and workflow_id=p_workflow_id for update;
 if not found or v_step.status<>'ACTIVE' or v_step.assignee_user_id<>(select auth.uid()) then raise exception 'Only the active assigned approver may act'; end if;
 v_resource_snapshot:=private.workflow_resource_snapshot(v_workflow.project_id,v_workflow.resource_type,v_workflow.resource_id);
 if v_resource_snapshot is null then raise exception 'RESOURCE_NOT_ELIGIBLE: workflow resource is missing or outside its original Project'; end if;
 v_resource_hash:=encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex');
 if v_resource_hash is distinct from v_workflow.resource_version then
  raise exception 'STALE_VERSION: workflow resource changed after approval started; return it for review and start a new workflow';
 end if;
 if p_action is null or p_action not in ('APPROVE','REJECT','RETURN') then raise exception 'Invalid workflow action'; end if;
 if length(trim(coalesce(p_reason,'')))>1000 then raise exception 'Workflow action reason must not exceed 1000 characters'; end if;
 if p_action in ('REJECT','RETURN') and length(trim(coalesce(p_reason,'')))<8 then raise exception 'Reason is required for rejection or return'; end if;
 if not private.has_project_permission(v_workflow.project_id,'workflow.step.act') then raise exception 'Workflow step permission required'; end if;
 if not private.has_project_permission(v_workflow.project_id,v_step.permission_code) then raise exception 'Current active Persona/Role does not grant the workflow action'; end if;
 if v_step.authority_code is not null and not private.has_project_authority(v_workflow.project_id,v_step.authority_code,v_workflow.authority_amount,v_workflow.authority_currency,v_workflow.authority_scope) then raise exception 'Required business authority or its amount/scope limit is not assigned or has expired'; end if;
 update public.workflow_steps set status=case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end,
  action=p_action,reason=nullif(trim(p_reason),''),acted_at=now() where id=p_step_id;
 if p_action='APPROVE' then
  select * into v_next from public.workflow_steps where workflow_id=p_workflow_id and step_order=v_step.step_order+1 for update;
  if found then
   update public.workflow_steps set status='ACTIVE',due_at=private.add_business_days(now(),coalesce((v_workflow.snapshot->>'sla_business_days')::integer,2),coalesce(v_workflow.snapshot->>'timezone','Asia/Jakarta'),v_workflow.workspace_id) where id=v_next.id;
   update public.workflow_instances set active_step_order=v_next.step_order,expected_version=expected_version+1,updated_at=now() where id=p_workflow_id;
   insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
   values(v_next.assignee_user_id,v_workflow.workspace_id,v_workflow.project_id,'WORKFLOW_STEP_ASSIGNED','Tugas approval berikutnya aktif','Step sebelumnya disetujui. Tugas Anda sekarang aktif dengan SLA baru.','workflow',p_workflow_id)
   on conflict do nothing;
  else
   update public.workflow_instances set status='COMPLETED',expected_version=expected_version+1,updated_at=now(),completed_at=now() where id=p_workflow_id;
   insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
   values(v_workflow.initiated_by,v_workflow.workspace_id,v_workflow.project_id,'WORKFLOW_COMPLETED','Workflow selesai','Seluruh tahap approval telah disetujui.','workflow',p_workflow_id)
   on conflict do nothing;
  end if;
 else
  update public.workflow_instances set status=case p_action when 'REJECT' then 'REJECTED' else 'RETURNED' end,
   expected_version=expected_version+1,updated_at=now(),completed_at=case when p_action='REJECT' then now() else null end where id=p_workflow_id;
  insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
  values(v_workflow.initiated_by,v_workflow.workspace_id,v_workflow.project_id,
   case when p_action='REJECT' then 'WORKFLOW_REJECTED' else 'WORKFLOW_RETURNED' end,
   case when p_action='REJECT' then 'Workflow ditolak' else 'Workflow dikembalikan' end,
   coalesce(nullif(trim(p_reason),''),'Workflow memerlukan perbaikan.'),'workflow',p_workflow_id)
  on conflict do nothing;
 end if;
 insert into public.workflow_events(workflow_id,step_id,actor_id,event_type,from_status,to_status,reason,details,idempotency_key)
 values(p_workflow_id,p_step_id,(select auth.uid()),'STEP_'||p_action,'ACTIVE',
  case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end,
  nullif(trim(p_reason),''),jsonb_build_object('step_order',v_step.step_order,'expected_version',p_expected_version),p_idempotency_key)
 returning id into v_event_id;
 return jsonb_build_object('workflow_id',p_workflow_id,'event_id',v_event_id,'action',p_action,'step_order',v_step.step_order,'idempotent_replay',false);
end $wfbody3$;

create or replace function public.act_project_workflow_step(
 p_workflow_id uuid,p_step_id uuid,p_action text,p_reason text,p_expected_version integer,p_idempotency_key uuid
) returns jsonb language sql security invoker set search_path=''
as $wfinline$ select private.act_project_workflow_step(p_workflow_id,p_step_id,p_action,p_reason,p_expected_version,p_idempotency_key); $wfinline$;

create or replace function private.appoint_project_signatory(
 p_membership_id uuid,p_project_id uuid,p_document_type text,p_scope jsonb,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text
) returns uuid language plpgsql security definer set search_path=''
as $signatory$
declare v_member public.company_memberships;v_project public.projects;v_id uuid;v_scope jsonb;
begin
 select * into v_project from public.projects where id=p_project_id and status='ACTIVE';
 select * into v_member from public.company_memberships where id=p_membership_id and membership_status='ACTIVE';
 if not found or v_project.id is null or v_member.user_id is null
  or v_member.workspace_id<>v_project.workspace_id
  or v_member.company_id is distinct from (select company_id from public.workspaces where id=v_project.workspace_id)
  or not private.is_company_super_admin(v_project.workspace_id) then
  raise exception 'Company Super Admin, active same-tenant Company Membership and linked User Identity required';
 end if;
 if length(trim(coalesce(p_document_type,'')))<2 or length(trim(coalesce(p_reason,'')))<8 then raise exception 'Document type and reason are required'; end if;
 if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
  or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k<>'document_type')
  or (p_scope ? 'document_type' and p_scope->>'document_type'<>trim(p_document_type)) then
  raise exception 'Only the document_type appointment scope is currently supported; Project scope is stored separately';
 end if;
 v_scope:=jsonb_build_object('document_type',trim(p_document_type));
 if p_ends_at is not null and p_ends_at<=coalesce(p_starts_at,now()) then raise exception 'Invalid appointment period'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text||':'||trim(p_document_type),0));
 with revoked as (
  update public.project_signatory_appointments
  set status='REVOKED',revoked_at=now(),revoked_by=(select auth.uid()),
   revocation_reason='Superseded by a replacement Final Signatory appointment'
  where workspace_id=v_project.workspace_id and project_id=p_project_id
   and document_type=trim(p_document_type) and status='ACTIVE'
  returning id,workspace_id,project_id,user_id,document_type
 )
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 select (select auth.uid()),r.workspace_id,r.project_id,'project.final_signatory.replaced','project_signatory_appointment',r.id::text,
  jsonb_build_object('user_id',r.user_id,'document_type',r.document_type,'reason','Superseded by a replacement Final Signatory appointment')
 from revoked r;
 insert into public.project_signatory_appointments(company_id,workspace_id,project_id,company_membership_id,user_id,document_type,scope,starts_at,ends_at,appointed_by,reason)
 values(v_member.company_id,v_member.workspace_id,p_project_id,v_member.id,v_member.user_id,trim(p_document_type),v_scope,coalesce(p_starts_at,now()),p_ends_at,(select auth.uid()),trim(p_reason))
 returning id into v_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v_member.workspace_id,p_project_id,'project.final_signatory.appointed','project_signatory_appointment',v_id::text,
  jsonb_build_object('membership_id',v_member.id,'user_id',v_member.user_id,'document_type',p_document_type,'scope',v_scope,'reason',trim(p_reason)));
 return v_id;
end
$signatory$;

create or replace function private.import_boq_master_batch_scoped(
 p_workspace_id uuid,p_project_id uuid,p_sections jsonb,p_items jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_sections integer:=0; v_items integer:=0; v_project public.projects;
begin
 select * into v_project from public.projects where id=p_project_id and workspace_id=p_workspace_id and status='ACTIVE';
 if not found or not private.has_project_permission(p_project_id,'boq.create') then raise exception 'Active Project BOQ create permission required'; end if;
 if jsonb_typeof(p_sections)<>'array' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Invalid BOQ batch payload'; end if;
 if jsonb_array_length(p_sections)>5000 or jsonb_array_length(p_items)>50000 then raise exception 'BOQ batch limit exceeded'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where not exists(select 1 from jsonb_to_recordset(p_items) r(boq_code text) where r.boq_code=x->>'boq_code' group by r.boq_code having count(*)=1)) then raise exception 'Duplicate BOQ code in import batch'; end if;
 if exists(select 1 from jsonb_array_elements(p_sections) x where not exists(select 1 from jsonb_to_recordset(p_sections) r(source_row int) where r.source_row=(x->>'source_row')::int group by r.source_row having count(*)=1)) then raise exception 'Duplicate BOQ section source row in import batch'; end if;
 if exists(select 1 from public.boq_items b join jsonb_to_recordset(p_items) x(boq_code text) on x.boq_code=b.boq_code where b.workspace_id is distinct from p_workspace_id or b.project_id is distinct from p_project_id) then raise exception 'BOQ code already belongs to a different Project; use a reviewed project-specific mapping'; end if;
 if exists(select 1 from public.boq_sections b join jsonb_to_recordset(p_sections) x(source_row int) on b.source_sheet='Trainer & UDU Office' and b.source_row=x.source_row where b.workspace_id is distinct from p_workspace_id or b.project_id is distinct from p_project_id) then raise exception 'BOQ section source row already belongs to a different Project'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Import reason must contain 8-500 characters'; end if;
 if exists(select 1 from jsonb_to_recordset(p_sections) x(source_row int,node_code text,description text,level int,parent_source_row int,sort_order int,source_color text,source_qty numeric,source_uom text,source_total_price numeric) where source_row is null or description is null or level not between 1 and 3) then raise exception 'Invalid BOQ section row'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) x(boq_code text,description text,quantity numeric,uom text,unit_rate numeric,remarks text,is_stock_item boolean,source_excel_row int,parent_source_row int,category text) where coalesce(trim(boq_code),'')='' or coalesce(trim(description),'')='' or source_excel_row is null or coalesce(quantity,0)<0 or coalesce(unit_rate,0)<0) then raise exception 'Invalid BOQ item row'; end if;
 insert into public.boq_sections(workspace_id,project_id,source_sheet,source_row,node_code,description,level,parent_id,sort_order,source_color,source_qty,source_uom,source_total_price,updated_by)
 select p_workspace_id,p_project_id,'Trainer & UDU Office',x.source_row,x.node_code,x.description,x.level,null,coalesce(x.sort_order,x.source_row),coalesce(x.source_color,'FFFFFF'),x.source_qty,x.source_uom,x.source_total_price,(select auth.uid())
 from jsonb_to_recordset(p_sections) x(source_row int,node_code text,description text,level int,parent_source_row int,sort_order int,source_color text,source_qty numeric,source_uom text,source_total_price numeric)
 on conflict(source_sheet,source_row) do update set workspace_id=excluded.workspace_id,project_id=excluded.project_id,node_code=excluded.node_code,description=excluded.description,level=excluded.level,sort_order=excluded.sort_order,source_color=excluded.source_color,source_qty=excluded.source_qty,source_uom=excluded.source_uom,source_total_price=excluded.source_total_price,updated_by=(select auth.uid()),updated_at=now();
 get diagnostics v_sections=row_count;
 update public.boq_sections child set parent_id=parent.id,updated_by=(select auth.uid()),updated_at=now()
 from jsonb_to_recordset(p_sections) x(source_row int,parent_source_row int)
 left join public.boq_sections parent on parent.workspace_id=p_workspace_id and parent.project_id=p_project_id and parent.source_sheet='Trainer & UDU Office' and parent.source_row=x.parent_source_row
 where child.workspace_id=p_workspace_id and child.project_id=p_project_id and child.source_sheet='Trainer & UDU Office' and child.source_row=x.source_row and child.parent_id is distinct from parent.id;
 insert into public.boq_items(workspace_id,project_id,boq_code,description,category,quantity,uom,unit_rate,remarks,source_sheet,source_row,source_excel_row,parent_section_id,is_active,is_stock_item,baseline_quantity,baseline_unit_rate)
 select p_workspace_id,p_project_id,x.boq_code,x.description,x.category,x.quantity,x.uom,coalesce(x.unit_rate,0),x.remarks,'Trainer & UDU Office',x.source_excel_row+5,x.source_excel_row,s.id,true,coalesce(x.is_stock_item,true),x.quantity,coalesce(x.unit_rate,0)
 from jsonb_to_recordset(p_items) x(boq_code text,description text,quantity numeric,uom text,unit_rate numeric,remarks text,is_stock_item boolean,source_excel_row int,parent_source_row int,category text)
 left join public.boq_sections s on s.workspace_id=p_workspace_id and s.project_id=p_project_id and s.source_sheet='Trainer & UDU Office' and s.source_row=x.parent_source_row
 on conflict(boq_code) do update set workspace_id=excluded.workspace_id,project_id=excluded.project_id,description=excluded.description,category=excluded.category,quantity=excluded.quantity,uom=excluded.uom,unit_rate=excluded.unit_rate,remarks=excluded.remarks,source_row=excluded.source_row,source_excel_row=excluded.source_excel_row,parent_section_id=excluded.parent_section_id,is_active=true,is_stock_item=excluded.is_stock_item,baseline_quantity=excluded.baseline_quantity,baseline_unit_rate=excluded.baseline_unit_rate,updated_at=now();
 get diagnostics v_items=row_count;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'BOQ_BATCH_IMPORT','boq_master',null,
 jsonb_build_object('reason',trim(p_reason),'sections_affected',v_sections,'items_affected',v_items));
 return jsonb_build_object('success',true,'sections_affected',v_sections,'items_affected',v_items,'project_id',p_project_id);
end $$;

create or replace function private.project_scope_guard(p_project_id uuid,p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $$
 select p_project_id is not null and p_permission_code is not null
   and private.has_project_permission(p_project_id,p_permission_code)
$$;

create or replace function private.attachment_project_scope_guard(p_project_id uuid,p_transaction_kind text,p_action text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare v_permission text;
begin
 if p_transaction_kind='INVENTORY' then
  v_permission:=case p_action when 'read' then 'inventory.read' when 'create' then 'inventory.movement.create' else null end;
 elsif p_transaction_kind='CASH' then
  v_permission:=case p_action when 'read' then 'cash.read' when 'create' then 'cash.transaction.create' else null end;
 else return false;
 end if;
 return private.project_scope_guard(p_project_id,v_permission);
end $$;

create or replace function private.storage_project_scope_guard(p_name text,p_permission_code text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare v_folder text;
begin
 v_folder:=(storage.foldername(p_name))[1];
 if v_folder is null or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
 then return false; end if;
 return private.project_scope_guard(v_folder::uuid,p_permission_code);
end $$;

create or replace function private.has_project_permission(p_project_id uuid,p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1
  from public.projects p
  join public.project_memberships pm on pm.project_id=p.id and pm.workspace_id=p.workspace_id
  join public.company_memberships cm on cm.id=pm.company_membership_id and cm.workspace_id=pm.workspace_id
  join public.project_permission_catalog pc on pc.permission_code=p_permission_code and pc.active
  join public.user_active_persona_contexts ap on ap.user_id=cm.user_id and ap.workspace_id=cm.workspace_id
  join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.persona_code=ap.persona_code
    and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
  where p.id=p_project_id and p.status='ACTIVE'
   and pm.user_id=(select auth.uid()) and pm.membership_status='ACTIVE'
   and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
   and (not pc.requires_authority_check or exists(
     select 1 from public.company_membership_authority_assignments aa
     where aa.company_membership_id=cm.id and aa.project_id=p_project_id and aa.authority_code=p_permission_code
      and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
   ))
   and (
    exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code=p_permission_code)
    or exists(select 1 from public.company_membership_role_assignments ra
      join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=p_permission_code and rp.active
      where ra.company_membership_id=cm.id and ra.workspace_id=cm.workspace_id
       and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()))
   )
 )
$$;

create or replace function private.set_role_permission_mapping(p_role_code text,p_permission_code text,p_active boolean,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not exists(select 1 from public.platform_admins where user_id=(select auth.uid())) then raise exception 'Platform Super Admin required'; end if;
 if not exists(select 1 from public.role_catalog where role_code=p_role_code and active)
  or not exists(select 1 from public.project_permission_catalog where permission_code=p_permission_code and active) then raise exception 'Active Role and Permission catalog entries required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 insert into public.role_permission_catalog(role_code,permission_code,active,approved_by,approved_at)
 values(p_role_code,p_permission_code,p_active,(select auth.uid()),now())
 on conflict(role_code,permission_code) do update set active=excluded.active,approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values((select auth.uid()),'platform.role_permission_mapping.changed','role_permission_catalog',p_role_code||':'||p_permission_code,
 jsonb_build_object('role_code',p_role_code,'permission_code',p_permission_code,'active',p_active,'reason',trim(p_reason)));
end $$;

create or replace function public.set_role_permission_mapping(p_role_code text,p_permission_code text,p_active boolean,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.set_role_permission_mapping(p_role_code,p_permission_code,p_active,p_reason); $$;

create or replace function private.preview_company_access_snapshot(p_workspace_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_project jsonb; v_result jsonb:='[]'::jsonb; v_direct text[]; v_role text[]; v_effective text[];
begin
 if not private.is_company_super_admin(p_workspace_id) then raise exception 'Active Company Super Admin required'; end if;
 for v_project in select value from jsonb_array_elements(p_snapshot->'project_assignments') loop
  select coalesce(array_agg(distinct x),'{}') into v_direct from jsonb_array_elements_text(v_project->'permission_codes') x;
  select coalesce(array_agg(distinct rp.permission_code),'{}') into v_role
   from public.role_permission_catalog rp
   where rp.active and rp.role_code=any(array(select jsonb_array_elements_text(p_snapshot->'role_codes')));
  select array(select distinct x from unnest(v_direct||v_role) x order by x) into v_effective;
  v_result:=v_result||jsonb_build_array(jsonb_build_object('project_id',v_project->>'project_id','direct_permissions',v_direct,'role_permissions',v_role,'effective_permissions',v_effective));
 end loop;
 return jsonb_build_object('persona_codes',p_snapshot->'persona_codes','role_codes',p_snapshot->'role_codes','projects',v_result,
  'authority_scopes',coalesce(p_snapshot->'authority_scopes','[]'::jsonb),
  'company_super_admin',false,'platform_super_admin',false);
end $$;

create or replace function public.preview_company_access_snapshot(p_workspace_id uuid,p_snapshot jsonb)
returns jsonb language sql security invoker set search_path=''
as $$ select private.preview_company_access_snapshot(p_workspace_id,p_snapshot); $$;

create or replace function private.set_my_active_persona(p_workspace_id uuid,p_persona_code text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_membership uuid;
begin
 select id into v_membership from public.company_memberships
 where workspace_id=p_workspace_id and user_id=(select auth.uid()) and membership_status='ACTIVE';
 if v_membership is null then raise exception 'Active Company Membership required'; end if;
 if not exists(select 1 from public.company_membership_persona_assignments a
  where a.company_membership_id=v_membership and a.persona_code=p_persona_code and a.revoked_at is null
   and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())) then
  raise exception 'Persona is not assigned or has expired';
 end if;
 insert into public.user_active_persona_contexts(user_id,workspace_id,persona_code)
 values((select auth.uid()),p_workspace_id,p_persona_code)
 on conflict(user_id,workspace_id) do update set persona_code=excluded.persona_code,updated_at=now();
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,'workspace.active_persona.changed','persona_context',(select auth.uid())::text,
  jsonb_build_object('persona_code',p_persona_code));
end $$;

create or replace function public.set_my_active_persona(p_workspace_id uuid,p_persona_code text)
returns void language sql security invoker set search_path=''
as $$ select private.set_my_active_persona(p_workspace_id,p_persona_code); $$;

create or replace function public.resolve_my_active_context()
returns jsonb language sql stable set search_path=''
as $$
 select case when (select auth.uid()) is null then jsonb_build_object('authenticated',false)
 else jsonb_build_object(
  'authenticated',true,'user_id',(select auth.uid()),
  'is_platform_super_admin',private.is_platform_super_admin(),
  'workspaces',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',w.id,'type',w.workspace_type,'name',w.display_name,'status',w.status,'company_id',w.company_id,
    'access_basis',case when w.workspace_type='PERSONAL' then 'OWNER' else 'ACTIVE_COMPANY_MEMBERSHIP' end,
    'personas',coalesce((select jsonb_agg(jsonb_build_object('persona_code',pa.persona_code,'display_name',pc.display_name,'description',pc.description) order by pc.sort_order)
      from public.company_memberships cm join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id
      join public.persona_catalog pc on pc.persona_code=pa.persona_code and pc.active
      where cm.workspace_id=w.id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
       and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())), '[]'::jsonb),
    'active_persona_code',(select ap.persona_code from public.user_active_persona_contexts ap
      where ap.user_id=(select auth.uid()) and ap.workspace_id=w.id
       and exists(select 1 from public.company_memberships cm join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id
        where cm.workspace_id=w.id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
         and pa.persona_code=ap.persona_code and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())) limit 1)
   ) order by w.created_at)
   from public.workspaces w where
    (w.workspace_type='PERSONAL' and w.owner_user_id=(select auth.uid()))
    or (w.workspace_type='COMPANY' and exists(select 1 from public.company_memberships cm where cm.workspace_id=w.id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'))
  ),'[]'::jsonb),
  'projects',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',p.id,'workspace_id',p.workspace_id,'project_code',p.project_code,'name',p.name,'status',p.status,'membership_id',pm.id,
    'permissions',coalesce((select jsonb_agg(x.permission_code order by x.permission_code) from (
      select pp.permission_code from public.project_membership_permissions pp where pp.project_membership_id=pm.id
      union
      select rp.permission_code from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.active
       where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
    ) x join public.project_permission_catalog pc on pc.permission_code=x.permission_code and pc.active
    where exists(select 1 from public.user_active_persona_contexts ap join public.company_membership_persona_assignments pa
      on pa.company_membership_id=cm.id and pa.persona_code=ap.persona_code
      where ap.user_id=(select auth.uid()) and ap.workspace_id=cm.workspace_id and pa.revoked_at is null
       and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now()))), '[]'::jsonb)
   ) order by p.created_at)
   from public.project_memberships pm join public.projects p on p.id=pm.project_id and p.workspace_id=pm.workspace_id
   join public.company_memberships cm on cm.id=pm.company_membership_id and cm.workspace_id=pm.workspace_id
    and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
   where pm.user_id=(select auth.uid()) and pm.membership_status='ACTIVE'
  ),'[]'::jsonb)
 ) end;
$$;

create or replace function private.set_company_membership_status(p_membership_id uuid,p_status text,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_member public.company_memberships;
begin
 select * into v_member from public.company_memberships where id=p_membership_id for update;
 if not found or v_member.is_company_super_admin or not private.is_company_super_admin(v_member.workspace_id) then
  raise exception 'Active Company Super Admin and non-admin membership required';
 end if;
 if p_status not in ('ACTIVE','SUSPENDED','REVOKED') then raise exception 'Unsupported membership status'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 update public.company_memberships set membership_status=p_status,updated_at=now(),
  activated_at=case when p_status='ACTIVE' then coalesce(activated_at,now()) else activated_at end
 where id=p_membership_id;
 if p_status<>'ACTIVE' then
  update public.project_memberships set membership_status='REVOKED',updated_at=now()
   where company_membership_id=p_membership_id and membership_status='ACTIVE';
  update public.company_membership_persona_assignments set revoked_at=coalesce(revoked_at,now()),ends_at=coalesce(ends_at,now())
   where company_membership_id=p_membership_id and revoked_at is null;
  update public.company_membership_role_assignments set revoked_at=coalesce(revoked_at,now()),ends_at=coalesce(ends_at,now())
   where company_membership_id=p_membership_id and revoked_at is null;
  update public.company_membership_authority_assignments set revoked_at=coalesce(revoked_at,now()),ends_at=coalesce(ends_at,now())
   where company_membership_id=p_membership_id and revoked_at is null;
  delete from public.user_active_persona_contexts where user_id=v_member.user_id and workspace_id=v_member.workspace_id;
 end if;
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v_member.workspace_id,'company_membership.status_changed','company_membership',p_membership_id::text,
  jsonb_build_object('user_id',v_member.user_id,'from_status',v_member.membership_status,'to_status',p_status,'reason',trim(p_reason)));
end $$;

create or replace function public.set_company_membership_status(p_membership_id uuid,p_status text,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.set_company_membership_status(p_membership_id,p_status,p_reason); $$;

create or replace function private.close_safety_report_scoped(p_workspace_id uuid,p_project_id uuid,p_report_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_report public.safety_reports;
begin
 if not private.has_project_permission(p_project_id,'k3.report.close') then raise exception 'K3 close permission required'; end if;
 select * into v_report from public.safety_reports
 where id=p_report_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found or v_report.status<>'OPEN' then raise exception 'Open K3 report not found in active Project'; end if;
 if not private.has_project_authority(p_project_id,'k3.report.close',null,null,jsonb_build_object('workflow_stage','K3')) then raise exception 'K3 close Authority scope required'; end if;
 if v_report.reported_by=(select auth.uid()) then raise exception 'Reporter cannot close their own K3 report'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Close reason is required'; end if;
 update public.safety_reports set status='CLOSED',reviewed_by=(select auth.uid()),reviewed_at=now(),
  action_taken=concat_ws(E'\n',nullif(action_taken,''),'Penutupan: '||trim(p_reason))
 where id=p_report_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'k3.report.closed','safety_report',p_report_id::text,jsonb_build_object('reason',trim(p_reason)));
end $$;

create or replace function public.close_safety_report_scoped(p_workspace_id uuid,p_project_id uuid,p_report_id uuid,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.close_safety_report_scoped(p_workspace_id,p_project_id,p_report_id,p_reason); $$;

create or replace function private.issue_project_document_scoped(p_workspace_id uuid,p_project_id uuid,p_document_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $docsign$
declare
 v_doc public.documents;v_membership_id uuid;v_appointment_id uuid;v_appointment_count integer;
 v_signer_name text;v_signer_company text;v_resource_snapshot jsonb;v_resource_hash text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 select * into v_doc from public.documents d
 where d.id=p_document_id and d.workspace_id=p_workspace_id and d.project_id=p_project_id for update;
 if not found or v_doc.status<>'APPROVED' or v_doc.revoked_at is not null or v_doc.lifecycle_status<>'ACTIVE' then
  raise exception 'Only the current approved, non-revoked document version can be signed and issued';
 end if;
  if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE') then raise exception 'Active Project scope required for final signing'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Signing and issuance reason must contain 8-500 characters'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text||':'||v_doc.document_type,0));
 select cm.id into v_membership_id from public.company_memberships cm
 where cm.user_id=(select auth.uid()) and cm.workspace_id=p_workspace_id
  and cm.company_id=(select w.company_id from public.workspaces w where w.id=p_workspace_id)
  and cm.membership_status='ACTIVE'
 order by cm.created_at desc limit 1;
 if v_membership_id is null then raise exception 'Active Company Membership in the document tenant is required'; end if;
 select count(*) into v_appointment_count from public.project_signatory_appointments a
 where a.project_id=p_project_id and a.workspace_id=p_workspace_id and a.document_type=v_doc.document_type
  and a.status='ACTIVE' and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
  and a.scope @> jsonb_build_object('document_type',v_doc.document_type);
 if v_appointment_count<>1 then raise exception 'Exactly one active Final Signatory appointment for this Project and document type is required'; end if;
 select a.id into v_appointment_id from public.project_signatory_appointments a
 where a.project_id=p_project_id and a.workspace_id=p_workspace_id and a.company_membership_id=v_membership_id
  and a.user_id=(select auth.uid()) and a.document_type=v_doc.document_type and a.status='ACTIVE'
  and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
  and a.scope @> jsonb_build_object('document_type',v_doc.document_type);
 if not found then raise exception 'Active Company Membership plus explicit Final Signatory appointment is required'; end if;
 if not exists(select 1 from public.workflow_instances w where w.project_id=p_project_id and w.resource_type='DOCUMENT'
  and w.resource_id=p_document_id and w.process_type='DOCUMENT' and w.status='COMPLETED') then
  raise exception 'All serial approval steps must be completed before final signing';
 end if;
 select private.workflow_resource_snapshot(p_project_id,'DOCUMENT',p_document_id) into v_resource_snapshot;
 if v_resource_snapshot is null then raise exception 'Approved document resource is unavailable'; end if;
 v_resource_hash:=encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex');
 if not exists(select 1 from public.workflow_instances w where w.project_id=p_project_id and w.resource_type='DOCUMENT'
  and w.resource_id=p_document_id and w.process_type='DOCUMENT' and w.status='COMPLETED' and w.resource_version=v_resource_hash) then
  raise exception 'STALE_VERSION: the approved document changed after workflow completion; start a new approval workflow';
 end if;
 select coalesce(nullif(trim(p.full_name),''),u.email),coalesce(nullif(trim(v_doc.company_name),''),'Company Member')
 into v_signer_name,v_signer_company from auth.users u left join public.profiles p on p.id=u.id where u.id=(select auth.uid());
 insert into public.document_signatures(document_id,workspace_id,project_id,signer_id,signer_name,signer_role,company,authority_level,decision,note,snapshot_sha256)
 values(p_document_id,p_workspace_id,p_project_id,(select auth.uid()),coalesce(v_signer_name,'Final Signatory'),'Final Signatory',
  v_signer_company,null,'APPROVED','Final Signatory approval and issuance: '||trim(p_reason),v_doc.content_sha256);
 update public.documents set status='ISSUED',issued_at=now(),verification_token=coalesce(verification_token,pg_catalog.gen_random_uuid()),updated_at=now()
 where id=p_document_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'document.final_signed_and_issued','document',p_document_id::text,
  jsonb_build_object('document_no',v_doc.document_no,'content_sha256',v_doc.content_sha256,'membership_id',v_membership_id,
   'appointment_id',v_appointment_id,'document_type',v_doc.document_type,'reason',trim(p_reason),'workflow_completed',true));
end
$docsign$;



create or replace function public.create_project_document_snapshot_scoped(
 p_workspace_id uuid,p_project_id uuid,p_document_type text,p_title text,
 p_period_start date,p_period_end date,p_approval_level text
) returns jsonb language plpgsql security definer set search_path=''
as $doccreate$
declare
 v_project public.projects;v_workspace public.workspaces;
 v_email text;v_permission text;v_records jsonb:='[]'::jsonb;v_amount numeric(18,2):=0;v_total integer:=0;
 v_snapshot jsonb;v_hash text;v_document_no text;v_document_id uuid;v_now timestamptz:=now();
 v_signer_name text;v_signer_role text;v_company_name text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Valid document period is required'; end if;
 if length(trim(coalesce(p_title,'')))<3 or length(trim(p_title))>200 then raise exception 'Document title must contain 3-200 characters'; end if;
 if p_approval_level is null or p_approval_level not in ('MINOR','MAJOR') then raise exception 'Unsupported approval level'; end if;
 select * into v_project from public.projects where id=p_project_id and workspace_id=p_workspace_id and status='ACTIVE';
 if not found then raise exception 'Active Project and Workspace scope required'; end if;
 select * into v_workspace from public.workspaces where id=p_workspace_id and company_id=v_project.company_id;
 if not found then raise exception 'Company Workspace scope mismatch'; end if;
 if not private.has_project_permission(p_project_id,'document.create') then raise exception 'document.create permission required'; end if;
 v_permission:=case p_document_type
  when 'LAPORAN_PROGRES' then 'progress.read'
   when 'LAPORAN_PROGRES_IMK' then 'progress.read'
  when 'LAPORAN_K3' then 'k3.read'
  when 'MUTASI_KAS' then 'cash.read'
  when 'SURAT_TERIMA_BARANG' then 'inventory.read'
  when 'BAST' then 'inventory.read'
  else null end;
 if v_permission is null then raise exception 'Unsupported document type'; end if;
 if not private.has_project_permission(p_project_id,v_permission) then raise exception 'Source permission % required',v_permission; end if;
 select coalesce(nullif(trim(p.full_name),''),u.email),coalesce(nullif(trim(p.job_title),''),nullif(trim(p.role),''),'Company Member'),
  u.email
 into v_signer_name,v_signer_role,v_email
 from auth.users u left join public.profiles p on p.id=u.id where u.id=(select auth.uid());
 v_signer_name:=coalesce(v_signer_name,v_email,'Company Member');
 v_signer_role:=coalesce(v_signer_role,'Company Member');
 v_company_name:=coalesce(nullif(trim(v_workspace.name),''),'Company');

 if p_document_type='MUTASI_KAS' then
  perform 1 from public.cash_transactions t where t.workspace_id=p_workspace_id and t.project_id=p_project_id
   and t.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and t.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta') for share;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at,t.id),'[]'::jsonb),
   coalesce(sum(t.amount),0),count(*)::integer
  into v_records,v_amount,v_total from public.cash_transactions t
  where t.workspace_id=p_workspace_id and t.project_id=p_project_id
   and t.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and t.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta');
 elsif p_document_type in ('SURAT_TERIMA_BARANG','BAST') then
  perform 1 from public.inventory_transactions it where it.workspace_id=p_workspace_id and it.project_id=p_project_id
   and it.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and it.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta') for share;
  perform 1 from public.boq_items bi where bi.workspace_id=p_workspace_id and bi.project_id=p_project_id
   and bi.id in (select it.item_id from public.inventory_transactions it where it.workspace_id=p_workspace_id and it.project_id=p_project_id
    and it.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
    and it.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta')) for share;
  select coalesce(jsonb_agg(jsonb_build_object('transaction',to_jsonb(it),'boq_item',to_jsonb(bi)) order by it.occurred_at,it.id),'[]'::jsonb),
   coalesce(sum(it.quantity*bi.unit_rate),0),count(*)::integer
  into v_records,v_amount,v_total from public.inventory_transactions it
  join public.boq_items bi on bi.id=it.item_id and bi.workspace_id=p_workspace_id and bi.project_id=p_project_id
  where it.workspace_id=p_workspace_id and it.project_id=p_project_id
   and it.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and it.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta');
  if v_total<>(select count(*) from public.inventory_transactions it where it.workspace_id=p_workspace_id and it.project_id=p_project_id
   and it.occurred_at>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and it.occurred_at< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta')) then
   raise exception 'Inventory document snapshot contains an item outside the selected Project';
  end if;
 elsif p_document_type in ('LAPORAN_PROGRES','LAPORAN_PROGRES_IMK') then
  perform 1 from public.progress_logs p where p.workspace_id=p_workspace_id and p.project_id=p_project_id
   and p.week_start>=p_period_start and p.week_end<=p_period_end for share;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.week_start,p.work_package,p.id),'[]'::jsonb),count(*)::integer
  into v_records,v_total from public.progress_logs p
  where p.workspace_id=p_workspace_id and p.project_id=p_project_id
   and p.week_start>=p_period_start and p.week_end<=p_period_end;
 elsif p_document_type='LAPORAN_K3' then
  perform 1 from public.safety_reports sr where sr.workspace_id=p_workspace_id and sr.project_id=p_project_id
   and sr.report_date>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and sr.report_date< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta') for share;
  select coalesce(jsonb_agg(to_jsonb(sr) order by sr.report_date,sr.id),'[]'::jsonb),count(*)::integer
  into v_records,v_total from public.safety_reports sr
  where sr.workspace_id=p_workspace_id and sr.project_id=p_project_id
   and sr.report_date>= (p_period_start::timestamp at time zone 'Asia/Jakarta')
   and sr.report_date< ((p_period_end+1)::timestamp at time zone 'Asia/Jakarta');
 end if;
 v_snapshot:=jsonb_build_object(
  'schema_version',1,'platform','Proyek Cair',
  'workspace',jsonb_build_object('id',v_workspace.id,'name',v_workspace.name,'company_id',v_workspace.company_id),
  'project',jsonb_build_object('id',v_project.id,'code',v_project.project_code,'name',v_project.name),
  'document_type',p_document_type,'title',trim(p_title),'period_start',p_period_start,'period_end',p_period_end,
  'created_at',v_now,'created_by',(select auth.uid()),
  'prepared_by',jsonb_build_object('name',v_signer_name,'role',v_signer_role,'company',v_company_name),
  'source_permission',v_permission,'total_transactions',v_total,'amount_summary',v_amount,'records',v_records
 );
 v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');
 v_document_no:='DOC-'||upper(left(regexp_replace(coalesce(v_project.project_code,'PROJECT'),'[^A-Za-z0-9]+','-','g'),20))
  ||'-'||to_char(v_now at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,8));
 insert into public.documents(workspace_id,project_id,document_no,title,document_type,status,content_sha256,
  period_start,period_end,signer_name,signer_role,signer_email,total_transactions,amount_summary,qr_payload,
  snapshot,created_by,company_name,approval_level,verification_token,created_at)
 values(p_workspace_id,p_project_id,v_document_no,trim(p_title),p_document_type,'DRAFT',v_hash,
  p_period_start,p_period_end,v_signer_name,v_signer_role,v_email,v_total,v_amount,null,
  v_snapshot,(select auth.uid()),v_company_name,p_approval_level,pg_catalog.gen_random_uuid(),v_now)
 returning id into v_document_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'document.created.snapshot','document',v_document_id::text,
  jsonb_build_object('document_no',v_document_no,'document_type',p_document_type,'content_sha256',v_hash,
   'period_start',p_period_start,'period_end',p_period_end,'total_transactions',v_total,'amount_summary',v_amount));
 return jsonb_build_object('id',v_document_id,'document_no',v_document_no,'title',trim(p_title),
  'document_type',p_document_type,'status','DRAFT','content_sha256',v_hash,'total_transactions',v_total,'amount_summary',v_amount);
end $doccreate$;


-- Immutable document lifecycle: BATAL invalidates the current issued version;
-- GANTI creates a new DRAFT revision and permanently links both versions.
alter table public.documents
 add column if not exists lifecycle_status text not null default 'ACTIVE' check(lifecycle_status in ('ACTIVE','BATAL','GANTI')),
 add column if not exists revision_number integer not null default 1 check(revision_number>0),
 add column if not exists replaces_document_id uuid references public.documents(id),
 add column if not exists replaced_by_document_id uuid references public.documents(id),
 add column if not exists cancelled_at timestamptz,
 add column if not exists cancelled_by uuid references auth.users(id),
 add column if not exists cancellation_reason text,
 add column if not exists replaced_at timestamptz,
 add column if not exists replacement_reason text;

create unique index if not exists documents_replaces_document_uidx
 on public.documents(replaces_document_id) where replaces_document_id is not null;
create index if not exists documents_lifecycle_project_idx
 on public.documents(workspace_id,project_id,lifecycle_status,revision_number);

create table if not exists public.document_lifecycle_events(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null,
 document_id uuid not null references public.documents(id),
 related_document_id uuid references public.documents(id),
 event_type text not null check(event_type in ('BATAL','GANTI','REPLACEMENT_CREATED')),
 actor_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 8 and 500),
 previous_lifecycle_status text,
 next_lifecycle_status text not null,
 idempotency_key uuid,
 transaction_id bigint not null default pg_catalog.txid_current(),
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 constraint document_lifecycle_events_project_scope_fk
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id)
);
create unique index if not exists document_lifecycle_events_idempotency_uidx
 on public.document_lifecycle_events(project_id,idempotency_key) where idempotency_key is not null;
create index if not exists document_lifecycle_events_document_time_idx
 on public.document_lifecycle_events(project_id,document_id,created_at desc);
alter table public.document_lifecycle_events enable row level security;
revoke all on public.document_lifecycle_events from public,anon,authenticated;
grant select on public.document_lifecycle_events to authenticated;
drop policy if exists document_lifecycle_events_project_read on public.document_lifecycle_events;
create policy document_lifecycle_events_project_read on public.document_lifecycle_events
 for select to authenticated using(private.project_scope_guard(project_id,'document.read'));

create or replace function private.guard_document_lifecycle_fields()
returns trigger language plpgsql security definer set search_path=''
as $docguard$
begin
 if row(new.lifecycle_status,new.revision_number,new.replaces_document_id,new.replaced_by_document_id,
   new.cancelled_at,new.cancelled_by,new.cancellation_reason,new.replaced_at,new.replacement_reason,new.revoked_at)
  is distinct from
  row(old.lifecycle_status,old.revision_number,old.replaces_document_id,old.replaced_by_document_id,
   old.cancelled_at,old.cancelled_by,old.cancellation_reason,old.replaced_at,old.replacement_reason,old.revoked_at) then
  if not exists(select 1 from public.document_lifecycle_events e
   where e.document_id=old.id and e.actor_id=(select auth.uid())
    and e.transaction_id=pg_catalog.txid_current()
    and e.event_type in ('BATAL','GANTI','REPLACEMENT_CREATED')) then
   raise exception 'Document lifecycle fields can only change through the audited BATAL/GANTI RPC';
  end if;
 end if;
 return new;
end
$docguard$;
drop trigger if exists documents_lifecycle_fields_guard on public.documents;
create trigger documents_lifecycle_fields_guard
 before update of lifecycle_status,revision_number,replaces_document_id,replaced_by_document_id,
  cancelled_at,cancelled_by,cancellation_reason,replaced_at,replacement_reason,revoked_at
 on public.documents for each row execute function private.guard_document_lifecycle_fields();

create or replace function public.cancel_project_document_scoped(
 p_workspace_id uuid,p_project_id uuid,p_document_id uuid,p_reason text,p_idempotency_key uuid
) returns void language plpgsql security definer set search_path=''
as $doccancel$
declare v_doc public.documents;v_event public.document_lifecycle_events;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'BATAL reason must contain 8-500 characters'; end if;
 select * into v_doc from public.documents d
  where d.id=p_document_id and d.workspace_id=p_workspace_id and d.project_id=p_project_id for update;
 if not found then raise exception 'Document not found in the selected Project'; end if;
 select * into v_event from public.document_lifecycle_events
  where project_id=p_project_id and idempotency_key=p_idempotency_key;
 if found then
  if v_event.event_type='BATAL' and v_event.document_id=p_document_id
   and v_event.actor_id=(select auth.uid()) and v_event.reason=trim(p_reason) then return; end if;
  raise exception 'IDEMPOTENCY_KEY_REUSED: key is bound to another document lifecycle request';
 end if;
 if v_doc.status not in ('ISSUED','SIGNED') or v_doc.lifecycle_status<>'ACTIVE' or v_doc.revoked_at is not null then
  raise exception 'Only the current issued and active document version can be marked BATAL';
 end if;
 if not private.has_project_permission(p_project_id,'document.void') then
  raise exception 'document.void permission required';
 end if;
 if not private.has_project_authority(p_project_id,'document.void',v_doc.amount_summary,'IDR',
  jsonb_build_object('document_type',v_doc.document_type,'workflow_stage','DOCUMENT_VOID')) then
  raise exception 'document.void Authority and scope required';
 end if;
 insert into public.document_lifecycle_events(workspace_id,project_id,document_id,event_type,actor_id,reason,
  previous_lifecycle_status,next_lifecycle_status,idempotency_key,transaction_id,details)
 values(p_workspace_id,p_project_id,p_document_id,'BATAL',(select auth.uid()),trim(p_reason),
  v_doc.lifecycle_status,'BATAL',p_idempotency_key,pg_catalog.txid_current(),
  jsonb_build_object('document_no',v_doc.document_no,'content_sha256',v_doc.content_sha256));
 update public.documents set lifecycle_status='BATAL',revoked_at=now(),cancelled_at=now(),
  cancelled_by=(select auth.uid()),cancellation_reason=trim(p_reason),updated_at=now()
 where id=p_document_id and workspace_id=p_workspace_id and project_id=p_project_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'document.BATAL','document',p_document_id::text,
  jsonb_build_object('document_no',v_doc.document_no,'reason',trim(p_reason),'content_sha256',v_doc.content_sha256));
end
$doccancel$;

create or replace function public.create_project_document_replacement_scoped(
 p_workspace_id uuid,p_project_id uuid,p_old_document_id uuid,p_title text,
 p_period_start date,p_period_end date,p_approval_level text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $docreplace$
declare
 v_old public.documents;v_new public.documents;v_event public.document_lifecycle_events;
 v_new_result jsonb;v_new_id uuid;v_details jsonb;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'GANTI reason must contain 8-500 characters'; end if;
 select * into v_old from public.documents d
  where d.id=p_old_document_id and d.workspace_id=p_workspace_id and d.project_id=p_project_id for update;
 if not found then raise exception 'Original document not found in the selected Project'; end if;
 v_details:=jsonb_build_object('title',trim(p_title),'period_start',p_period_start,
  'period_end',p_period_end,'approval_level',p_approval_level,'document_type',v_old.document_type);
 select * into v_event from public.document_lifecycle_events
  where project_id=p_project_id and idempotency_key=p_idempotency_key;
 if found then
  if v_event.event_type='GANTI' and v_event.document_id=p_old_document_id
   and v_event.actor_id=(select auth.uid()) and v_event.reason=trim(p_reason) and v_event.details=v_details
   and v_event.related_document_id is not null then
   select * into v_new from public.documents where id=v_event.related_document_id
    and workspace_id=p_workspace_id and project_id=p_project_id;
   if not found then raise exception 'Replacement document linked by idempotency record is unavailable'; end if;
   return jsonb_build_object('id',v_new.id,'document_no',v_new.document_no,'title',v_new.title,
    'document_type',v_new.document_type,'status',v_new.status,'lifecycle_status',v_new.lifecycle_status,
    'revision_number',v_new.revision_number,'replaces_document_no',v_old.document_no,'content_sha256',v_new.content_sha256);
  end if;
  raise exception 'IDEMPOTENCY_KEY_REUSED: key is bound to another document lifecycle request';
 end if;
 if v_old.status not in ('ISSUED','SIGNED') or v_old.lifecycle_status<>'ACTIVE' or v_old.revoked_at is not null
  or v_old.replaced_by_document_id is not null then
  raise exception 'Only the current issued and active document version can be replaced';
 end if;
 if not private.has_project_permission(p_project_id,'document.replace') then
  raise exception 'document.replace permission required';
 end if;
 if not private.has_project_authority(p_project_id,'document.replace',v_old.amount_summary,'IDR',
  jsonb_build_object('document_type',v_old.document_type,'workflow_stage','DOCUMENT_REPLACE')) then
  raise exception 'document.replace Authority and scope required';
 end if;
 -- Reuse the canonical server snapshot builder; any failure rolls back the entire replacement transaction.
 v_new_result:=public.create_project_document_snapshot_scoped(
  p_workspace_id,p_project_id,v_old.document_type,p_title,p_period_start,p_period_end,p_approval_level);
 v_new_id:=(v_new_result->>'id')::uuid;
 select * into v_new from public.documents d
  where d.id=v_new_id and d.workspace_id=p_workspace_id and d.project_id=p_project_id for update;
 if not found or v_new.status<>'DRAFT' or v_new.lifecycle_status<>'ACTIVE' then
  raise exception 'Replacement draft could not be created in the same Project';
 end if;
 insert into public.document_lifecycle_events(workspace_id,project_id,document_id,related_document_id,event_type,actor_id,reason,
  previous_lifecycle_status,next_lifecycle_status,idempotency_key,transaction_id,details)
 values(p_workspace_id,p_project_id,v_old.id,v_new.id,'GANTI',(select auth.uid()),trim(p_reason),
  v_old.lifecycle_status,'GANTI',p_idempotency_key,pg_catalog.txid_current(),v_details);
 insert into public.document_lifecycle_events(workspace_id,project_id,document_id,related_document_id,event_type,actor_id,reason,
  previous_lifecycle_status,next_lifecycle_status,transaction_id,details)
 values(p_workspace_id,p_project_id,v_new.id,v_old.id,'REPLACEMENT_CREATED',(select auth.uid()),trim(p_reason),
  v_new.lifecycle_status,'ACTIVE',pg_catalog.txid_current(),v_details);
 update public.documents set lifecycle_status='GANTI',revoked_at=now(),replaced_by_document_id=v_new.id,
  replaced_at=now(),replacement_reason=trim(p_reason),updated_at=now()
 where id=v_old.id and workspace_id=p_workspace_id and project_id=p_project_id;
 update public.documents set revision_number=v_old.revision_number+1,replaces_document_id=v_old.id,
  replacement_reason=trim(p_reason),updated_at=now()
 where id=v_new.id and workspace_id=p_workspace_id and project_id=p_project_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'document.GANTI','document',v_old.id::text,
  jsonb_build_object('old_document_no',v_old.document_no,'new_document_id',v_new.id,
   'new_document_no',v_new.document_no,'revision_number',v_old.revision_number+1,
   'reason',trim(p_reason),'content_sha256_old',v_old.content_sha256,'content_sha256_new',v_new.content_sha256));
 return v_new_result||jsonb_build_object('revision_number',v_old.revision_number+1,
  'replaces_document_no',v_old.document_no,'lifecycle_status','ACTIVE');
end
$docreplace$;

drop function if exists public.verify_private_document_qr(uuid);
drop function if exists private.verify_private_document_qr(uuid);

create or replace function private.verify_private_document_qr(p_token uuid)
returns table (
 document_no text,title text,document_type text,status text,content_sha256 text,
 issued_at timestamptz,created_at timestamptz,period_start date,period_end date,
 signer_name text,signer_role text,company_name text,approval_level text,
 lifecycle_status text,is_valid boolean,replaced_by_document_no text,revision_number integer
) language plpgsql security definer set search_path=''
as $docqr$
declare v_actor uuid:=(select auth.uid());v_doc public.documents;v_outcome text;
 v_lifecycle_status text;v_is_valid boolean;v_replacement_no text;
begin
 if v_actor is null or p_token is null then return; end if;
 select d.* into v_doc from public.documents d where d.verification_token=p_token limit 1;
 if not found then
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'DOCUMENT_QR_VERIFY_DENIED','DOCUMENT_QR',null,jsonb_build_object('outcome','NOT_FOUND','source','PRIVATE_QR_ROUTE'));
  return;
 end if;
 if v_doc.status not in ('ISSUED','SIGNED','REVOKED') or v_doc.workspace_id is null or v_doc.project_id is null then
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
  values(v_actor,'DOCUMENT_QR_VERIFY_DENIED','DOCUMENT_QR',v_doc.id::text,
   jsonb_build_object('outcome','NOT_AVAILABLE','source','PRIVATE_QR_ROUTE'),v_doc.workspace_id,v_doc.project_id);
  return;
 end if;
 if not private.has_project_permission(v_doc.project_id,'document.qr.scan')
  or not private.has_project_permission(v_doc.project_id,'document.qr.verify') then
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
  values(v_actor,'DOCUMENT_QR_VERIFY_DENIED','DOCUMENT_QR',v_doc.id::text,
   jsonb_build_object('outcome','PERMISSION_DENIED','source','PRIVATE_QR_ROUTE'),v_doc.workspace_id,v_doc.project_id);
  return;
 end if;
 v_lifecycle_status:=case when v_doc.status='REVOKED' or (v_doc.revoked_at is not null and v_doc.lifecycle_status='ACTIVE') then 'REVOKED' else v_doc.lifecycle_status end;
 v_is_valid:=v_doc.status in ('ISSUED','SIGNED') and v_doc.lifecycle_status='ACTIVE' and v_doc.revoked_at is null;
 select d.document_no into v_replacement_no from public.documents d
  where d.id=v_doc.replaced_by_document_id and d.workspace_id=v_doc.workspace_id and d.project_id=v_doc.project_id;
 v_outcome:=case when v_is_valid then 'VERIFIED' else v_lifecycle_status end;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values(v_actor,v_doc.workspace_id,v_doc.project_id,
  case when v_is_valid then 'DOCUMENT_QR_VERIFY_SUCCESS' else 'DOCUMENT_QR_VERIFY_INVALIDATED' end,
  'DOCUMENT_QR',v_doc.id::text,jsonb_build_object('outcome',v_outcome,'source','PRIVATE_QR_ROUTE',
   'lifecycle_status',v_lifecycle_status,'replacement_document_no',v_replacement_no));
 return query select v_doc.document_no,v_doc.title,v_doc.document_type,v_doc.status,v_doc.content_sha256,
  v_doc.issued_at,v_doc.created_at,v_doc.period_start,v_doc.period_end,v_doc.signer_name,v_doc.signer_role,
  v_doc.company_name,v_doc.approval_level,v_lifecycle_status,v_is_valid,v_replacement_no,v_doc.revision_number;
end
$docqr$;

create or replace function public.verify_private_document_qr(p_token uuid)
returns table (
 document_no text,title text,document_type text,status text,content_sha256 text,
 issued_at timestamptz,created_at timestamptz,period_start date,period_end date,
 signer_name text,signer_role text,company_name text,approval_level text,
 lifecycle_status text,is_valid boolean,replaced_by_document_no text,revision_number integer
) language sql security invoker set search_path=''
as $docqrpub$ select * from private.verify_private_document_qr(p_token) $docqrpub$;

revoke all on function private.verify_private_document_qr(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.verify_private_document_qr(uuid) to authenticated;
revoke all on function public.verify_private_document_qr(uuid) from public,anon;
grant execute on function public.verify_private_document_qr(uuid) to authenticated;


create or replace function public.list_my_final_signatory_documents()
returns table(
 document_id uuid,workspace_id uuid,project_id uuid,project_code text,project_name text,
 document_no text,title text,document_type text,status text,content_sha256 text,
 created_at timestamptz,period_start date,period_end date,company_name text,snapshot jsonb,resource_current boolean
) language plpgsql security definer set search_path=''
as $wfbody6$
declare v_row record;v_resource_snapshot jsonb;v_resource_hash text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 for v_row in
  select distinct on (d.id) d.id,d.workspace_id,d.project_id,p.project_code,p.name as project_name,
   d.document_no,d.title,d.document_type,d.status,d.content_sha256,d.created_at,d.period_start,d.period_end,
   d.company_name,d.snapshot,w.resource_version
  from public.documents d
  join public.projects p on p.id=d.project_id and p.workspace_id=d.workspace_id and p.status='ACTIVE'
  join public.company_memberships cm on cm.workspace_id=d.workspace_id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'
  join public.project_signatory_appointments a on a.company_membership_id=cm.id and a.project_id=d.project_id
   and a.workspace_id=d.workspace_id and a.user_id=(select auth.uid()) and a.document_type=d.document_type
   and a.status='ACTIVE' and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
   and a.scope @> jsonb_build_object('document_type',d.document_type)
  join public.workflow_instances w on w.project_id=d.project_id and w.resource_type='DOCUMENT'
   and w.resource_id=d.id and w.process_type='DOCUMENT' and w.status='COMPLETED'
  where d.status='APPROVED' and d.revoked_at is null and d.lifecycle_status='ACTIVE'
    and (select count(*) from public.project_signatory_appointments x where x.project_id=d.project_id and x.workspace_id=d.workspace_id
     and x.document_type=d.document_type and x.status='ACTIVE' and x.starts_at<=now() and (x.ends_at is null or x.ends_at>now())
     and x.scope @> jsonb_build_object('document_type',d.document_type))=1
  order by d.id,w.created_at desc
 loop
  v_resource_snapshot:=private.workflow_resource_snapshot(v_row.project_id,'DOCUMENT',v_row.id);
  v_resource_hash:=case when v_resource_snapshot is null then null else encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex') end;
  return query select v_row.id,v_row.workspace_id,v_row.project_id,v_row.project_code,v_row.project_name,
   v_row.document_no,v_row.title,v_row.document_type,v_row.status,v_row.content_sha256,
   v_row.created_at,v_row.period_start,v_row.period_end,v_row.company_name,v_row.snapshot,
   v_resource_hash is not null and v_resource_hash=v_row.resource_version;
 end loop;
end $wfbody6$;

create or replace function public.issue_project_document_scoped(p_workspace_id uuid,p_project_id uuid,p_document_id uuid,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.issue_project_document_scoped(p_workspace_id,p_project_id,p_document_id,p_reason); $$;

create or replace function private.link_project_personnel_identity(p_workspace_id uuid,p_project_id uuid,p_personnel_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not private.has_project_permission(p_project_id,'personnel.roster.manage') then raise exception 'Project roster management permission required'; end if;
 if not exists(select 1 from public.project_personnel p where p.id=p_personnel_id and p.workspace_id=p_workspace_id and p.project_id=p_project_id) then raise exception 'Roster record is outside active Project'; end if;
 if not exists(select 1 from public.project_memberships pm join public.company_memberships cm on cm.id=pm.company_membership_id
  where pm.project_id=p_project_id and pm.workspace_id=p_workspace_id and pm.user_id=p_user_id
   and pm.membership_status='ACTIVE' and cm.membership_status='ACTIVE') then
  raise exception 'Linked identity must already have an active Company and Project Membership';
 end if;
 update public.project_personnel set linked_user_id=p_user_id where id=p_personnel_id and workspace_id=p_workspace_id and project_id=p_project_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'project_personnel.identity_linked','project_personnel',p_personnel_id::text,
  jsonb_build_object('linked_user_id',p_user_id));
end $$;

create or replace function public.link_project_personnel_identity(p_workspace_id uuid,p_project_id uuid,p_personnel_id uuid,p_user_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.link_project_personnel_identity(p_workspace_id,p_project_id,p_personnel_id,p_user_id); $$;

drop function if exists public.list_project_workflow_approvers(uuid);
drop function if exists private.list_project_workflow_approvers(uuid);

create or replace function private.list_project_workflow_approvers(p_project_id uuid)
returns table(user_id uuid,email text,full_name text,persona_code text,role_codes text[],permission_codes text[],authority_codes text[])
language plpgsql stable security definer set search_path=''
as $$
begin
 if not exists(select 1 from public.projects p where p.id=p_project_id and private.has_project_permission(p_project_id,'workflow.start')) then
  raise exception 'Active Project workflow.start permission required';
 end if;
 return query
 select cm.user_id,u.email,coalesce(pr.full_name,''),ap.persona_code,
  coalesce((select array_agg(ra.role_code order by ra.role_code) from public.company_membership_role_assignments ra
   where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())),'{}'),
  array(select distinct x.permission_code from (
    select pp.permission_code from public.project_membership_permissions pp where pp.project_membership_id=pm.id
    union
    select rp.permission_code from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.active
     where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
  ) x join public.project_permission_catalog pc on pc.permission_code=x.permission_code and pc.active
   order by x.permission_code),
  coalesce((select array_agg(distinct aa.authority_code order by aa.authority_code)
   from public.company_membership_authority_assignments aa
   join public.authority_catalog ac on ac.authority_code=aa.authority_code and ac.active
   where aa.company_membership_id=cm.id and aa.project_id=p_project_id and aa.revoked_at is null
    and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())),'{}'::text[])
 from public.project_memberships pm
 join public.company_memberships cm on cm.id=pm.company_membership_id and cm.membership_status='ACTIVE'
 join auth.users u on u.id=cm.user_id
 left join public.profiles pr on pr.id=cm.user_id
 join public.user_active_persona_contexts ap on ap.user_id=cm.user_id and ap.workspace_id=cm.workspace_id
 join public.company_membership_persona_assignments pa on pa.company_membership_id=cm.id and pa.persona_code=ap.persona_code
  and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())
 where pm.project_id=p_project_id and pm.membership_status='ACTIVE'
  and (exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code='workflow.step.act')
   or exists(select 1 from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code='workflow.step.act' and rp.active
    where ra.company_membership_id=cm.id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())));
end $$;

create or replace function public.list_project_workflow_approvers(p_project_id uuid)
returns table(user_id uuid,email text,full_name text,persona_code text,role_codes text[],permission_codes text[],authority_codes text[])
language sql stable security invoker set search_path=''
as $$ select * from private.list_project_workflow_approvers(p_project_id); $$;

create or replace function private.preview_rfin_redemption(p_code text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_token public.rfin_tokens; v_email text; v_snapshot jsonb; v_projects jsonb:='[]'::jsonb; v_project jsonb;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 select lower(email) into v_email from auth.users where id=(select auth.uid());
 select * into v_token from public.rfin_tokens
 where token_hash=encode(extensions.digest(upper(trim(coalesce(p_code,''))),'sha256'),'hex');
 if not found or v_token.redeemed_at is not null or v_token.revoked_at is not null or v_token.expires_at<=now()
   or lower(v_token.recipient_email)<>v_email then raise exception 'RFIN invalid, expired, revoked, already redeemed, or recipient mismatch'; end if;
 if v_token.token_class='RFIN_A' then
  return jsonb_build_object('token_class','RFIN_A','company_name',(select legal_name from public.companies where id=v_token.company_id),
   'recipient_email',v_email,'expires_at',v_token.expires_at,'summary','Klaim satu kursi Company Super Admin. Company Workspace akan aktif setelah redemption.');
 end if;
 v_snapshot:=v_token.metadata->'snapshot';
 if coalesce(v_snapshot->>'schema_version','')<>'1' then raise exception 'RFIN-B access snapshot missing'; end if;
 for v_project in select value from jsonb_array_elements(v_snapshot->'project_assignments') loop
  v_projects:=v_projects||jsonb_build_array(jsonb_build_object(
   'project_id',v_project->>'project_id',
   'project_name',(select p.name from public.projects p where p.id=(v_project->>'project_id')::uuid),
   'project_code',(select p.project_code from public.projects p where p.id=(v_project->>'project_id')::uuid),
   'permissions',(select coalesce(jsonb_agg(jsonb_build_object('code',c.permission_code,'description',c.description) order by c.permission_code),'[]'::jsonb)
    from (select jsonb_array_elements_text(v_project->'permission_codes') as code union select rp.permission_code from public.role_permission_catalog rp where rp.active and rp.role_code=any(array(select jsonb_array_elements_text(v_snapshot->'role_codes')))) x join public.project_permission_catalog c on c.permission_code=x.code and c.active)
  ));
 end loop;
 return jsonb_build_object('token_class','RFIN_B','company_name',(select legal_name from public.companies where id=v_token.company_id),
  'recipient_email',v_email,'expires_at',v_token.expires_at,'display_name',v_snapshot->'display_name',
   'signatory_only',(jsonb_array_length(v_snapshot->'persona_codes')=0 and jsonb_array_length(v_snapshot->'project_assignments')=0),
   'company_permissions',(select coalesce(jsonb_agg(distinct rp.permission_code order by rp.permission_code),'[]'::jsonb)
    from public.role_permission_catalog rp join public.project_permission_catalog pc on pc.permission_code=rp.permission_code and pc.active
    where rp.active and rp.permission_code='document.sign' and rp.role_code=any(array(select jsonb_array_elements_text(v_snapshot->'role_codes')))),
  'personas',(select coalesce(jsonb_agg(jsonb_build_object('code',c.persona_code,'name',c.display_name) order by c.sort_order),'[]'::jsonb)
   from jsonb_array_elements_text(v_snapshot->'persona_codes') x(code) join public.persona_catalog c on c.persona_code=x.code),
  'roles',(select coalesce(jsonb_agg(jsonb_build_object('code',c.role_code,'name',c.display_name) order by c.sort_order),'[]'::jsonb)
   from jsonb_array_elements_text(v_snapshot->'role_codes') x(code) join public.role_catalog c on c.role_code=x.code),
  'projects',v_projects,'authority_scopes',coalesce(v_snapshot->'authority_scopes','[]'::jsonb),
  'notice','Company Membership dan semua assignment akan dibuat atomik setelah Anda menyetujui. Snapshot tidak dapat diubah setelah redemption.');
end $$;

-- RFIN-B is create-only. Existing Company Membership access must be replaced through the audited Company Console API.
create or replace function private.redeem_rfin(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_token public.rfin_tokens; v_user_email text; v_user_id uuid:=(select auth.uid());
 v_workspace uuid; v_membership uuid; v_attempt_count integer; v_attempt_id bigint;
 v_code text:=upper(trim(coalesce(p_code,''))); v_seat public.company_admin_seats;
 v_project jsonb; v_auth jsonb; v_pm uuid; v_code_item text;
begin
 if v_user_id is null then return jsonb_build_object('ok',false,'error','Authentication required'); end if;
 select lower(email) into v_user_email from auth.users where id=v_user_id;
 if v_user_email is null then return jsonb_build_object('ok',false,'error','Authenticated email unavailable'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text,0));
 select count(*) into v_attempt_count from public.rfin_redemption_attempts where user_id=v_user_id and attempted_at>now()-interval '15 minutes';
 if v_attempt_count>=10 then insert into public.rfin_redemption_attempts(user_id,succeeded) values(v_user_id,false); return jsonb_build_object('ok',false,'error','Too many attempts. Try again in 15 minutes.'); end if;
 insert into public.rfin_redemption_attempts(user_id,succeeded) values(v_user_id,false) returning id into v_attempt_id;
 if length(v_code)<12 or length(v_code)>64 then return jsonb_build_object('ok',false,'error','RFIN invalid, expired, revoked or already redeemed'); end if;
 select * into v_token from public.rfin_tokens where token_hash=encode(extensions.digest(v_code,'sha256'),'hex') for update;
 if not found or v_token.redeemed_at is not null or v_token.revoked_at is not null or v_token.expires_at<=now() then return jsonb_build_object('ok',false,'error','RFIN invalid, expired, revoked or already redeemed'); end if;
 if lower(v_token.recipient_email)<>v_user_email then return jsonb_build_object('ok',false,'error','RFIN invalid, expired, revoked or already redeemed'); end if;
 if v_token.token_class='RFIN_A' then
  perform 1 from public.companies where id=v_token.company_id and registration_status='CLAIM_PENDING' for update;
  if not found then return jsonb_build_object('ok',false,'error','Company claim is not available'); end if;
  select * into v_seat from public.company_admin_seats where company_id=v_token.company_id for update;
  if not found or v_seat.seat_status<>'UNCLAIMED' or lower(v_seat.recipient_email)<>v_user_email then return jsonb_build_object('ok',false,'error','Company Super Admin seat unavailable'); end if;
 else
  perform 1 from public.companies where id=v_token.company_id and registration_status in ('ACTIVE','VERIFIED') for update;
  if not found then return jsonb_build_object('ok',false,'error','Company is not active'); end if;
  if coalesce(v_token.metadata->'snapshot'->>'schema_version','')<>'1' then return jsonb_build_object('ok',false,'error','RFIN-B access snapshot missing. Ask the Company Super Admin to issue a new invitation.'); end if;
 end if;
 select id into v_workspace from public.workspaces where company_id=v_token.company_id and workspace_type='COMPANY' and status='ACTIVE';
 if v_workspace is null and v_token.token_class='RFIN_B' then return jsonb_build_object('ok',false,'error','Company Workspace unavailable'); end if;
 if v_token.token_class='RFIN_A' then
  select id into v_workspace from public.workspaces where company_id=v_token.company_id and workspace_type='COMPANY';
  if exists(select 1 from public.company_memberships where company_id=v_token.company_id and membership_status='ACTIVE' and is_company_super_admin) then return jsonb_build_object('ok',false,'error','Company Super Admin seat already claimed'); end if;
  insert into public.company_memberships(company_id,workspace_id,user_id,membership_status,is_company_super_admin,activated_at,invited_by)
  values(v_token.company_id,v_workspace,v_user_id,'ACTIVE',true,now(),v_token.issued_by) returning id into v_membership;
  update public.company_admin_seats set seat_status='CLAIMED',claimed_by=v_user_id,claimed_at=now(),updated_at=now() where company_id=v_token.company_id and seat_status='UNCLAIMED';
  if not found then raise exception 'Company Super Admin seat claim raced or is no longer available' using errcode='23505'; end if;
  update public.companies set registration_status='ACTIVE',updated_at=now() where id=v_token.company_id and registration_status='CLAIM_PENDING';
  if not found then raise exception 'Company activation raced or is no longer available' using errcode='23505'; end if;
  update public.workspaces set status='ACTIVE',updated_at=now() where id=v_workspace and status='CLAIM_PENDING';
  if not found then raise exception 'Company Workspace activation raced or is no longer available' using errcode='23505'; end if;
 else
  insert into public.company_memberships(company_id,workspace_id,user_id,membership_status,is_company_super_admin,activated_at,invited_by)
  values(v_token.company_id,v_workspace,v_user_id,'ACTIVE',false,now(),v_token.issued_by)
   on conflict(company_id,user_id) do nothing
   returning id into v_membership;
   if v_membership is null then
    return jsonb_build_object('ok',false,'error','Company Membership already exists; use Company Console to replace or reactivate access');
   end if;

  for v_code_item in select jsonb_array_elements_text(v_token.metadata->'snapshot'->'persona_codes') loop
   insert into public.company_membership_persona_assignments(company_membership_id,workspace_id,persona_code,assigned_by,reason)
   values(v_membership,v_workspace,v_code_item,v_token.issued_by,coalesce(v_token.metadata->>'issue_reason','RFIN-B approved snapshot'))
   on conflict do nothing;
  end loop;
  for v_code_item in select jsonb_array_elements_text(v_token.metadata->'snapshot'->'role_codes') loop
   insert into public.company_membership_role_assignments(company_membership_id,workspace_id,role_code,assigned_by,reason)
   values(v_membership,v_workspace,v_code_item,v_token.issued_by,coalesce(v_token.metadata->>'issue_reason','RFIN-B approved snapshot'))
   on conflict do nothing;
  end loop;
  for v_project in select value from jsonb_array_elements(v_token.metadata->'snapshot'->'project_assignments') loop
   insert into public.project_memberships(project_id,workspace_id,company_membership_id,user_id,assigned_by,membership_status)
   values((v_project->>'project_id')::uuid,v_workspace,v_membership,v_user_id,v_token.issued_by,'ACTIVE')
   on conflict(project_id,company_membership_id) do update set membership_status='ACTIVE',assigned_by=excluded.assigned_by,updated_at=now()
   returning id into v_pm;
   delete from public.project_membership_permissions where project_membership_id=v_pm;
   for v_code_item in select jsonb_array_elements_text(v_project->'permission_codes') loop
    insert into public.project_membership_permissions(project_membership_id,permission_code,granted_by)
    values(v_pm,v_code_item,v_token.issued_by);
   end loop;
  end loop;
  for v_auth in select value from jsonb_array_elements(coalesce(v_token.metadata->'snapshot'->'authority_scopes','[]'::jsonb)) loop
   insert into public.company_membership_authority_assignments(company_membership_id,workspace_id,project_id,authority_code,scope,max_amount,currency,assigned_by,reason)
   values(v_membership,v_workspace,(v_auth->>'project_id')::uuid,v_auth->>'authority_code',
     coalesce(v_auth->'scope','{}'::jsonb),nullif(v_auth->>'max_amount','')::numeric,nullif(v_auth->>'currency',''),
     v_token.issued_by,coalesce(v_token.metadata->>'issue_reason','RFIN-B approved snapshot'));
  end loop;
 end if;
 update public.rfin_tokens set redeemed_at=now(),redeemed_by=v_user_id where id=v_token.id and redeemed_at is null and revoked_at is null;
 if not found then raise exception 'RFIN redemption raced or token is no longer available' using errcode='23505'; end if;
 update public.rfin_redemption_attempts set succeeded=true where id=v_attempt_id;
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values(v_user_id,v_workspace,case when v_token.token_class='RFIN_A' then 'company_admin_seat.rfin_a_redeemed' else 'company_membership.rfin_b_snapshot_applied' end,
  case when v_token.token_class='RFIN_A' then 'company_admin_seat' else 'company_membership' end,
  coalesce(v_membership::text,v_token.company_id::text),
  jsonb_build_object('company_id',v_token.company_id,'workspace_id',v_workspace,'membership_id',v_membership,'token_id',v_token.id,
   'token_class',v_token.token_class,'snapshot_schema_version',v_token.metadata->'snapshot'->>'schema_version'));
 return jsonb_build_object('ok',true,'token_class',v_token.token_class,'company_id',v_token.company_id,'workspace_id',v_workspace,'membership_id',v_membership);
end $$;


create or replace function public.preview_rfin_redemption(p_code text)
returns jsonb language sql security invoker set search_path=''
as $$ select private.preview_rfin_redemption(p_code); $$;

create or replace function public.reverse_inventory_transaction_scoped(
 p_workspace_id uuid,p_project_id uuid,p_transaction_id uuid,p_reason text,p_idempotency_key uuid
) returns public.inventory_transactions
language plpgsql security definer set search_path=''
as $function$
declare v_original public.inventory_transactions%rowtype; v_reverse public.inventory_transactions%rowtype;
 v_item public.boq_items%rowtype; v_type text; v_balance numeric(18,4);
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not private.has_project_permission(p_project_id,'inventory.movement.reverse') then raise exception 'Inventory reverse permission required' using errcode='42501'; end if;
 if p_workspace_id is null or p_project_id is null or p_idempotency_key is null then raise exception 'Workspace, Project and idempotency key are required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Correction reason must contain at least 8 characters'; end if;
 select * into v_original from public.inventory_transactions t where t.id=p_transaction_id and t.workspace_id=p_workspace_id and t.project_id=p_project_id for update;
 if not found then raise exception 'Transaction not found in active Project' using errcode='42501'; end if;
 if not private.has_project_authority(p_project_id,'inventory.movement.reverse',v_original.quantity*v_item.unit_rate,'IDR',jsonb_build_object('transaction_category',v_original.transaction_type)) then raise exception 'Inventory reverse Authority scope required' using errcode='42501'; end if;
 if exists(select 1 from public.inventory_transaction_reversals r where r.original_transaction_id=p_transaction_id) then raise exception 'Transaction has already been reversed' using errcode='23505'; end if;
 v_type:=case v_original.transaction_type when 'MASUK' then 'PENYESUAIAN_KELUAR' when 'KELUAR' then 'PENYESUAIAN_MASUK' when 'PENYESUAIAN_MASUK' then 'PENYESUAIAN_KELUAR' else 'PENYESUAIAN_MASUK' end;
 select * into v_item from public.boq_items i where i.id=v_original.item_id and i.workspace_id=p_workspace_id and i.project_id=p_project_id and i.is_active and i.is_stock_item for update;
 if not found then raise exception 'Original BOQ item is no longer active'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_original.item_id::text||':'||v_original.owner_type,824631905177));
 select coalesce(sum(case when t.transaction_type in ('MASUK','PENYESUAIAN_MASUK') then t.quantity else -t.quantity end),0)
 into v_balance from public.inventory_transactions t where t.item_id=v_original.item_id and t.workspace_id=p_workspace_id and t.project_id=p_project_id and t.owner_type=v_original.owner_type;
 if v_type in ('KELUAR','PENYESUAIAN_KELUAR') and v_balance<v_original.quantity then raise exception 'Insufficient stock to reverse this transaction'; end if;
 insert into public.inventory_transactions(idempotency_key,item_id,transaction_type,quantity,uom,occurred_at,reference_no,counterparty,location,notes,created_by,source_name,destination_name,recipient_name,owner_type,purpose,addition_id,workspace_id,project_id)
 values(p_idempotency_key,v_original.item_id,v_type,v_original.quantity,v_item.uom,now(),'REV-'||coalesce(v_original.reference_no,v_original.id::text),
  'Koreksi transaksi',v_original.location,trim(p_reason),(select auth.uid()),coalesce(v_original.destination_name,'Lokasi proyek'),
  coalesce(v_original.source_name,'Lokasi asal'),'Koreksi oleh pengguna',v_original.owner_type,'Pembalikan transaksi '||v_original.id,
  v_original.addition_id,p_workspace_id,p_project_id)
 returning * into v_reverse;
 insert into public.inventory_transaction_reversals(original_transaction_id,reversal_transaction_id,reason,reversed_by,workspace_id,project_id)
 values(v_original.id,v_reverse.id,trim(p_reason),(select auth.uid()),p_workspace_id,p_project_id);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values((select auth.uid()),'INVENTORY_REVERSAL','inventory_transaction',v_original.id::text,
  jsonb_build_object('original_transaction_id',v_original.id,'reversal_transaction_id',v_reverse.id,'reason',trim(p_reason)),
  p_workspace_id,p_project_id);
 return v_reverse;
end
$function$;

create or replace function public.create_boq_addition_scoped(
 p_workspace_id uuid,p_project_id uuid,p_item_id uuid,p_description text,p_quantity numeric,p_uom text,p_unit_rate numeric,
 p_requester_type text,p_reason text,p_requested_by_name text,p_approval_reference text default null,p_notes text default null,
 p_is_stock_item boolean default true,p_owner_type text default 'KONTRAKTOR'
) returns public.boq_additions language plpgsql security definer set search_path=''
as $function$
declare v_item public.boq_items%rowtype; v_code text; v_result public.boq_additions%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if not private.has_project_permission(p_project_id,'boq.addition.create') then raise exception 'boq.addition.create permission required'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE') then raise exception 'Project/workspace scope invalid'; end if;
 if p_quantity is null or p_quantity<=0 or p_unit_rate is null or p_unit_rate<0 or coalesce(trim(p_uom),'')='' or coalesce(trim(p_reason),'')='' or coalesce(trim(p_requested_by_name),'')='' then raise exception 'Invalid BOQ addition details'; end if;
 if p_requester_type not in ('CLIENT','CONTRACTOR') or p_owner_type not in ('KONTRAKTOR','IMK') then raise exception 'Invalid requester or ownership'; end if;
 if p_item_id is null then
  if not private.has_project_permission(p_project_id,'boq.create') then raise exception 'Creating a new BOQ item requires boq.create permission'; end if;
  v_code:='ADD-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6));
  insert into public.boq_items(workspace_id,project_id,boq_code,description,category,quantity,uom,unit_rate,remarks,source_sheet,is_active,is_stock_item,baseline_quantity,baseline_unit_rate)
  values(p_workspace_id,p_project_id,v_code,trim(p_description),'Pekerjaan Tambahan',p_quantity,trim(p_uom),p_unit_rate,
   'Owner: '||p_owner_type,'Project Additions',true,coalesce(p_is_stock_item,true),p_quantity,p_unit_rate)
  returning * into v_item;
 else
  select * into v_item from public.boq_items i where i.id=p_item_id and i.workspace_id=p_workspace_id and i.project_id=p_project_id and i.is_active for update;
  if not found then raise exception 'BOQ item is outside active Project'; end if;
 end if;
 v_code:='ADD-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6));
 insert into public.boq_additions(addition_code,item_id,description,quantity,uom,unit_rate,requester_type,chargeable_to_client,reason,requested_by_name,approval_reference,notes,created_by,billing_status,workspace_id,project_id)
 values(v_code,v_item.id,coalesce(nullif(trim(p_description),''),v_item.description),p_quantity,trim(p_uom),p_unit_rate,p_requester_type,p_requester_type='CLIENT',
  trim(p_reason),trim(p_requested_by_name),nullif(trim(p_approval_reference),''),nullif(trim(p_notes),''),(select auth.uid()),
  case when p_requester_type='CLIENT' then 'BELUM_DITAGIHKAN' else 'TIDAK_DITAGIHKAN' end,p_workspace_id,p_project_id)
 returning * into v_result;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'boq.addition.created','boq_addition',v_result.id::text,
  jsonb_build_object('item_id',v_item.id,'new_item_created',p_item_id is null,'reason',trim(p_reason)));
 return v_result;
end
$function$;

create or replace function public.update_boq_addition_scoped(
 p_workspace_id uuid,p_project_id uuid,p_addition_id uuid,p_description text,p_quantity numeric,p_uom text,p_unit_rate numeric,
 p_requester_type text,p_reason text,p_requested_by_name text,p_approval_reference text default null,p_notes text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_add public.boq_additions;
begin
 if not private.has_project_permission(p_project_id,'boq.update') then raise exception 'boq.update permission required'; end if;
 select * into v_add from public.boq_additions where id=p_addition_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found or v_add.approval_status<>'DIAJUKAN' then raise exception 'Only a pending BOQ addition can be edited'; end if;
 if exists(select 1 from public.workflow_instances w where w.resource_type='BOQ' and w.resource_id=p_addition_id and w.status='ACTIVE') then raise exception 'BOQ addition cannot be edited while an approval workflow is active'; end if;
 if p_quantity<=0 or p_unit_rate<0 or length(trim(coalesce(p_description,'')))<2 or length(trim(coalesce(p_reason,'')))<8 then raise exception 'Invalid BOQ addition update'; end if;
 update public.boq_additions set description=trim(p_description),quantity=p_quantity,uom=trim(p_uom),unit_rate=p_unit_rate,
  requester_type=p_requester_type,chargeable_to_client=p_requester_type='CLIENT',reason=trim(p_reason),requested_by_name=trim(p_requested_by_name),
  approval_reference=nullif(trim(p_approval_reference),''),notes=nullif(trim(p_notes),'')
 where id=p_addition_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'boq.addition.updated','boq_addition',p_addition_id::text,
  jsonb_build_object('reason',trim(p_reason),'previous_status',v_add.approval_status));
end $$;

create or replace function public.update_boq_billing_status_scoped(p_workspace_id uuid,p_project_id uuid,p_addition_id uuid,p_billing_status text,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_add public.boq_additions;
begin
 if not private.has_project_permission(p_project_id,'boq.update') then raise exception 'boq.update permission required'; end if;
 if p_billing_status not in ('BELUM_DITAGIHKAN','DITAGIHKAN','DIBAYAR') then raise exception 'Invalid billing status'; end if;
 select * into v_add from public.boq_additions where id=p_addition_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found or v_add.approval_status<>'DISETUJUI' or v_add.requester_type<>'CLIENT' then raise exception 'Only approved client-requested additions can be billed'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Billing change reason required'; end if;
 update public.boq_additions set billing_status=p_billing_status where id=p_addition_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'boq.addition.billing_status_changed','boq_addition',p_addition_id::text,
  jsonb_build_object('from',v_add.billing_status,'to',p_billing_status,'reason',trim(p_reason)));
end $$;

drop function if exists public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb);
create or replace function public.create_procurement_request_scoped(
 p_workspace_id uuid,p_project_id uuid,p_supplier_name text,p_currency text,p_needed_by date,p_notes text,p_items jsonb,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $prcreate$
declare
 v_id uuid;v_no text;v_item jsonb;v_boq public.boq_items;v_qty numeric;v_unit_price numeric;
 v_hash text;v_existing public.procurement_requests;v_amount numeric(20,2):=0;
begin
 if not private.has_project_permission(p_project_id,'procurement.create') then raise exception 'procurement.create permission required'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE') then raise exception 'Project scope invalid'; end if;
 if p_idempotency_key is null then raise exception 'Procurement request idempotency key is required'; end if;
  if length(trim(coalesce(p_supplier_name,'')))<2 or length(trim(coalesce(p_supplier_name,'')))>160
   or p_currency is null or p_currency !~ '^[A-Z]{3}$'
   or length(trim(coalesce(p_notes,'')))>2000
   or p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
   raise exception 'Supplier, currency, needed date, notes or request items are invalid';
  end if;
 if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'item_id' having count(*)>1) then raise exception 'Duplicate BOQ item lines are not allowed'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('supplier_name',trim(p_supplier_name),'currency',p_currency,
  'needed_by',p_needed_by,'notes',nullif(trim(p_notes),''),'items',p_items)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text||p_idempotency_key::text,0));
 select * into v_existing from public.procurement_requests where project_id=p_project_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_existing.requested_by is distinct from (select auth.uid()) or v_existing.request_hash is distinct from v_hash then
   raise exception 'IDEMPOTENCY_KEY_REUSED: procurement request key belongs to a different payload';
  end if;
  return v_existing.id;
 end if;
 v_no:='PR-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,8));
 insert into public.procurement_requests(workspace_id,project_id,request_no,status,supplier_name,currency,needed_by,requested_by,notes,idempotency_key,request_hash)
 values(p_workspace_id,p_project_id,v_no,'DRAFT',trim(p_supplier_name),p_currency,p_needed_by,(select auth.uid()),nullif(trim(p_notes),''),p_idempotency_key,v_hash)
 returning id into v_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_boq from public.boq_items b where b.id=(v_item->>'item_id')::uuid
   and b.workspace_id=p_workspace_id and b.project_id=p_project_id and b.is_active for share;
  if not found then raise exception 'BOQ item is outside the active Project or inactive'; end if;
  v_qty:=nullif(v_item->>'quantity','')::numeric;
  v_unit_price:=nullif(v_item->>'unit_price','')::numeric;
  if v_qty is null or v_qty<=0 or v_unit_price is null or v_unit_price<0 then raise exception 'Invalid procurement quantity or unit price'; end if;
  v_amount:=v_amount+(v_qty*v_unit_price);
  insert into public.procurement_request_items(request_id,workspace_id,project_id,item_id,description,quantity,uom,unit_price)
  values(v_id,p_workspace_id,p_project_id,v_boq.id,v_boq.description,v_qty,v_boq.uom,v_unit_price);
 end loop;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'procurement.request.created','procurement_request',v_id::text,
  jsonb_build_object('request_no',v_no,'supplier_name',trim(p_supplier_name),'currency',p_currency,
   'amount_summary',v_amount,'item_count',jsonb_array_length(p_items),'idempotency_key',p_idempotency_key));
 return v_id;
end $prcreate$;

create or replace function private.apply_workflow_resource_transition()
returns trigger language plpgsql security definer set search_path=''
as $wfbody7$
declare v_permission text;v_resource_snapshot jsonb;v_resource_hash text;
begin
 v_permission:=coalesce(
  (select step_entry.value->>'permission_code'
   from jsonb_array_elements(coalesce(new.snapshot->'steps','[]'::jsonb)) as step_entry(value)
   order by coalesce((step_entry.value->>'step_order')::integer,0) desc limit 1),
  new.snapshot->>'permission_code');
 if new.status is distinct from old.status then
  if new.resource_type='PROCUREMENT' then
   update public.procurement_requests set status=case new.status when 'COMPLETED' then case when v_permission='procurement.approve' then 'APPROVED' else 'SUBMITTED' end when 'REJECTED' then 'REJECTED' when 'RETURNED' then 'SUBMITTED' else status end,
    approved_at=case when new.status='COMPLETED' and v_permission='procurement.approve' then now() else approved_at end,updated_at=now()
   where id=new.resource_id and project_id=new.project_id;
  elsif new.resource_type='BOQ' then
   update public.boq_additions set
    approval_status=case when new.status='COMPLETED' and v_permission='boq.approve' then 'DISETUJUI' when new.status='REJECTED' then 'DITOLAK' when new.status='RETURNED' then 'DIAJUKAN' else approval_status end,
    approved_by=case when new.status='COMPLETED' and v_permission='boq.approve' then (select auth.uid()) else approved_by end,
    approved_at=case when new.status='COMPLETED' and v_permission='boq.approve' then now() else approved_at end
   where id=new.resource_id and project_id=new.project_id;
  elsif new.resource_type='DOCUMENT' then
   update public.documents set status=case when new.status='COMPLETED' and v_permission='document.approve' then 'APPROVED' when new.status='REJECTED' then 'REJECTED' when new.status='RETURNED' then 'DRAFT' else status end,updated_at=now()
   where id=new.resource_id and project_id=new.project_id and status not in ('ISSUED','REVOKED');
  end if;
  if new.status='COMPLETED' then
   v_resource_snapshot:=private.workflow_resource_snapshot(new.project_id,new.resource_type,new.resource_id);
   if v_resource_snapshot is null then raise exception 'Completed workflow resource disappeared during state transition'; end if;
   v_resource_hash:=encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex');
   update public.workflow_instances set resource_version=v_resource_hash where id=new.id;
  end if;
 end if;
 return new;
end $wfbody7$;

create or replace function private.add_business_days(p_start timestamptz,p_days integer,p_timezone text default 'Asia/Jakarta',p_workspace_id uuid default null)
returns timestamptz language plpgsql stable set search_path=''
as $$
declare v_local timestamp;v_timezone text:=coalesce(nullif(trim(p_timezone),''),'Asia/Jakarta');v_count integer:=0;
begin
 if p_days<0 or p_days>365 then raise exception 'Business day interval must be between 0 and 365'; end if;
 v_local:=p_start at time zone v_timezone;
 if v_local::time<time '08:00' then v_local:=v_local::date+time '08:00';
 elsif v_local::time>time '17:00' then v_local:=v_local::date+time '17:00'; end if;
 while v_count<p_days loop
  v_local:=v_local+interval '1 day';
  if extract(isodow from v_local) between 1 and 5
   and (p_workspace_id is null or not exists(select 1 from public.workspace_business_holidays h where h.workspace_id=p_workspace_id and h.holiday_date=v_local::date)) then
   v_count:=v_count+1;
  end if;
 end loop;
 return v_local at time zone v_timezone;
end $$;

create or replace function private.delegate_project_workflow_step(p_workflow_id uuid,p_step_id uuid,p_delegate_user_id uuid,p_ends_at timestamptz,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_workflow public.workflow_instances;v_step public.workflow_steps;v_member public.company_memberships;
begin
 select * into v_workflow from public.workflow_instances where id=p_workflow_id for update;
 select * into v_step from public.workflow_steps where id=p_step_id and workflow_id=p_workflow_id for update;
 if not found or v_workflow.status<>'ACTIVE' or v_step.status<>'ACTIVE' then raise exception 'Only an active workflow step can be delegated'; end if;
 if v_step.assignee_user_id<>(select auth.uid()) and not private.is_company_super_admin(v_workflow.workspace_id) then raise exception 'Current assignee or Company Super Admin required'; end if;
 if v_step.assignee_user_id=(select auth.uid()) and not private.is_company_super_admin(v_workflow.workspace_id) and not private.has_project_permission(v_workflow.project_id,'workflow.delegate') then raise exception 'workflow.delegate permission required'; end if;
 if p_delegate_user_id=(select auth.uid()) or p_ends_at<=now() or p_ends_at>now()+interval '30 days' or length(trim(coalesce(p_reason,'')))<8 then raise exception 'Invalid delegate, period or reason'; end if;
 select cm.* into v_member from public.company_memberships cm join public.project_memberships pm on pm.company_membership_id=cm.id
 where cm.user_id=p_delegate_user_id and cm.workspace_id=v_workflow.workspace_id and cm.membership_status='ACTIVE'
  and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE';
 if not found or not exists(select 1 from public.user_active_persona_contexts ap join public.company_membership_persona_assignments pa on pa.company_membership_id=v_member.id and pa.persona_code=ap.persona_code
  where ap.user_id=p_delegate_user_id and ap.workspace_id=v_workflow.workspace_id and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())) then
  raise exception 'Delegate requires active membership, Project Membership and Persona';
 end if;
 if not exists(select 1 from public.project_memberships pm where pm.company_membership_id=v_member.id and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE'
  and (exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code=v_step.permission_code)
   or exists(select 1 from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=v_step.permission_code and rp.active where ra.company_membership_id=v_member.id and ra.revoked_at is null)))
  or not exists(select 1 from public.project_memberships pm where pm.company_membership_id=v_member.id and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE'
   and (exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code='workflow.step.act')
   or exists(select 1 from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code='workflow.step.act' and rp.active where ra.company_membership_id=v_member.id and ra.revoked_at is null))) then
  raise exception 'Delegate lacks action or workflow.step.act permission';
 end if;
 if v_step.authority_code is not null and not exists(select 1 from public.company_membership_authority_assignments aa where aa.company_membership_id=v_member.id and aa.project_id=v_workflow.project_id and aa.authority_code=v_step.authority_code and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now()) and (aa.max_amount is null or (v_workflow.authority_amount is not null and aa.max_amount>=v_workflow.authority_amount and aa.currency=v_workflow.authority_currency)) and (aa.scope='{}'::jsonb or v_workflow.authority_scope @> aa.scope)) then raise exception 'Delegate lacks required Authority/limit'; end if;
 insert into public.workflow_step_delegations(workflow_id,step_id,delegator_user_id,delegate_user_id,starts_at,ends_at,reason)
 values(p_workflow_id,p_step_id,v_step.assignee_user_id,p_delegate_user_id,now(),p_ends_at,trim(p_reason));
 update public.workflow_steps set assignee_user_id=p_delegate_user_id,due_at=least(coalesce(due_at,p_ends_at),p_ends_at) where id=p_step_id;
 insert into public.workflow_events(workflow_id,step_id,actor_id,event_type,from_status,to_status,reason,details)
 values(p_workflow_id,p_step_id,(select auth.uid()),'STEP_DELEGATED','ACTIVE','ACTIVE',trim(p_reason),jsonb_build_object('delegate_user_id',p_delegate_user_id,'ends_at',p_ends_at));
 insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
 values(p_delegate_user_id,v_workflow.workspace_id,v_workflow.project_id,'WORKFLOW_DELEGATED','Tugas approval didelegasikan','Anda menerima delegasi step workflow. Periksa detail dan due date.', 'workflow',p_workflow_id);
end $$;

create or replace function public.delegate_project_workflow_step(p_workflow_id uuid,p_step_id uuid,p_delegate_user_id uuid,p_ends_at timestamptz,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.delegate_project_workflow_step(p_workflow_id,p_step_id,p_delegate_user_id,p_ends_at,p_reason); $$;

create or replace function private.reassign_project_workflow_step(p_workflow_id uuid,p_step_id uuid,p_new_assignee_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_workflow public.workflow_instances;v_step public.workflow_steps;v_member public.company_memberships;
begin
 select * into v_workflow from public.workflow_instances where id=p_workflow_id for update;
 select * into v_step from public.workflow_steps where id=p_step_id and workflow_id=p_workflow_id for update;
 if not found or v_workflow.status<>'ACTIVE' or v_step.status<>'ACTIVE' then raise exception 'Only active workflow step can be reassigned'; end if;
 if not private.is_company_super_admin(v_workflow.workspace_id) and not private.has_project_permission(v_workflow.project_id,'workflow.reassign') then raise exception 'Workflow reassign permission required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Reassignment reason required'; end if;
 select cm.* into v_member from public.company_memberships cm join public.project_memberships pm on pm.company_membership_id=cm.id
 where cm.user_id=p_new_assignee_id and cm.workspace_id=v_workflow.workspace_id and cm.membership_status='ACTIVE'
  and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE';
 if not found or not exists(select 1 from public.user_active_persona_contexts ap join public.company_membership_persona_assignments pa on pa.company_membership_id=v_member.id and pa.persona_code=ap.persona_code
  where ap.user_id=p_new_assignee_id and ap.workspace_id=v_workflow.workspace_id and pa.revoked_at is null and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now())) then raise exception 'New assignee lacks active membership/project/persona'; end if;
 if not exists(select 1 from public.project_memberships pm where pm.company_membership_id=v_member.id and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE'
  and (exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code=v_step.permission_code)
   or exists(select 1 from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code=v_step.permission_code and rp.active where ra.company_membership_id=v_member.id and ra.revoked_at is null))) then raise exception 'New assignee lacks action permission'; end if;
 if not exists(select 1 from public.project_memberships pm where pm.company_membership_id=v_member.id and pm.project_id=v_workflow.project_id and pm.membership_status='ACTIVE' and (exists(select 1 from public.project_membership_permissions pp where pp.project_membership_id=pm.id and pp.permission_code='workflow.step.act') or exists(select 1 from public.company_membership_role_assignments ra join public.role_permission_catalog rp on rp.role_code=ra.role_code and rp.permission_code='workflow.step.act' and rp.active where ra.company_membership_id=v_member.id and ra.revoked_at is null))) then raise exception 'New assignee lacks workflow.step.act permission'; end if;
 if v_step.authority_code is not null and not exists(select 1 from public.company_membership_authority_assignments aa where aa.company_membership_id=v_member.id and aa.project_id=v_workflow.project_id and aa.authority_code=v_step.authority_code and aa.revoked_at is null and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now()) and (aa.max_amount is null or (v_workflow.authority_amount is not null and aa.max_amount>=v_workflow.authority_amount and aa.currency=v_workflow.authority_currency)) and (aa.scope='{}'::jsonb or v_workflow.authority_scope @> aa.scope)) then raise exception 'New assignee lacks Authority/limit'; end if;
 update public.workflow_steps set assignee_user_id=p_new_assignee_id where id=p_step_id;
 insert into public.workflow_events(workflow_id,step_id,actor_id,event_type,from_status,to_status,reason,details)
 values(p_workflow_id,p_step_id,(select auth.uid()),'STEP_REASSIGNED','ACTIVE','ACTIVE',trim(p_reason),jsonb_build_object('previous_assignee_id',v_step.assignee_user_id,'new_assignee_id',p_new_assignee_id));
 insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
 values(p_new_assignee_id,v_workflow.workspace_id,v_workflow.project_id,'WORKFLOW_REASSIGNED','Tugas approval dialihkan','Anda ditetapkan sebagai approver aktif.', 'workflow',p_workflow_id);
end $$;

create or replace function public.reassign_project_workflow_step(p_workflow_id uuid,p_step_id uuid,p_new_assignee_id uuid,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.reassign_project_workflow_step(p_workflow_id,p_step_id,p_new_assignee_id,p_reason); $$;

create or replace function private.cancel_project_workflow(p_workflow_id uuid,p_reason text,p_expected_version integer)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.workflow_instances;
begin
 select * into v from public.workflow_instances where id=p_workflow_id for update;
 if not found or v.status<>'ACTIVE' or v.expected_version<>p_expected_version then raise exception 'Workflow missing, inactive or stale'; end if;
 if v.initiated_by<>(select auth.uid()) and not private.is_company_super_admin(v.workspace_id)
  and not private.has_project_permission(v.project_id,'workflow.cancel') then raise exception 'Workflow cancel permission required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Cancellation reason required'; end if;
 update public.workflow_instances set status='CANCELLED',expected_version=expected_version+1,updated_at=now() where id=p_workflow_id;
 update public.workflow_steps set status='SKIPPED' where workflow_id=p_workflow_id and status in ('PENDING','ACTIVE');
 insert into public.workflow_events(workflow_id,actor_id,event_type,from_status,to_status,reason)
 values(p_workflow_id,(select auth.uid()),'WORKFLOW_CANCELLED','ACTIVE','CANCELLED',trim(p_reason));
end $$;

create or replace function public.cancel_project_workflow(p_workflow_id uuid,p_reason text,p_expected_version integer)
returns void language sql security invoker set search_path=''
as $$ select private.cancel_project_workflow(p_workflow_id,p_reason,p_expected_version); $$;

create or replace function private.count_business_days(p_start timestamptz,p_end timestamptz,p_timezone text,p_workspace_id uuid)
returns integer language plpgsql stable security definer set search_path=''
as $$
declare v_date date;v_end date;v_count integer:=0;v_timezone text:=coalesce(nullif(trim(p_timezone),''),'Asia/Jakarta');
begin
 if p_end<=p_start then return 0; end if;
 v_date:=(p_start at time zone v_timezone)::date;
 v_end:=(p_end at time zone v_timezone)::date;
 while v_date<v_end loop
  v_date:=v_date+1;
  if extract(isodow from v_date) between 1 and 5
   and not exists(select 1 from public.workspace_business_holidays h where h.workspace_id=p_workspace_id and h.holiday_date=v_date) then
   v_count:=v_count+1;
  end if;
 end loop;
 return v_count;
end $$;
revoke all on function private.count_business_days(timestamptz,timestamptz,text,uuid) from public,anon,authenticated;

create or replace function private.run_workflow_sla_sweep()
returns integer language plpgsql security definer set search_path=''
as $$
declare v record;v_count integer:=0;v_type text;v_target uuid;v_overdue integer;v_level integer;v_max_level integer;
begin
 if coalesce((select auth.role()),'')<>'service_role' and session_user not in ('postgres','supabase_admin') then raise exception 'Service role or database scheduler required'; end if;
 for v in
  select w.*,s.id step_id,s.assignee_user_id,s.due_at
  from public.workflow_instances w
  join public.workflow_steps s on s.workflow_id=w.id and s.status='ACTIVE'
  where w.status='ACTIVE' and s.due_at is not null
   and s.due_at<=private.add_business_days(now(),1,coalesce(w.snapshot->>'timezone','Asia/Jakarta'),w.workspace_id)
 loop
  v_type:=case when v.due_at<=now() then 'WORKFLOW_SLA_DUE' else 'WORKFLOW_SLA_REMINDER' end;
  insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
  values(v.assignee_user_id,v.workspace_id,v.project_id,v_type,
   case when v_type='WORKFLOW_SLA_DUE' then 'SLA approval terlewati' else 'Pengingat SLA approval' end,
   'Tugas workflow memerlukan tindak lanjut. SLA tidak menghasilkan auto-approval.','workflow',v.id)
  on conflict do nothing;
  v_overdue:=private.count_business_days(v.due_at,now(),coalesce(v.snapshot->>'timezone','Asia/Jakarta'),v.workspace_id);
  if v_overdue>=1 then
   select cm.user_id into v_target from public.company_memberships cm
   where cm.workspace_id=v.workspace_id and cm.is_company_super_admin and cm.membership_status='ACTIVE' limit 1;
   if v_target is not null then
    v_max_level:=1+((v_overdue-1)/2);
    for v_level in 1..v_max_level loop
     insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
     values(v_target,v.workspace_id,v.project_id,'WORKFLOW_SLA_ESCALATION_'||v_level,
      case when v_level=1 then 'Workflow melewati SLA' else 'Eskalasi workflow lanjutan #'||v_level end,
      'Workflow masih menunggu tindakan setelah '||v_overdue||' hari kerja. Tidak ada step yang otomatis disetujui atau dilewati.',
      'workflow',v.id)
     on conflict do nothing;
    end loop;
   end if;
  end if;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

create or replace function public.import_project_backup_scoped(p_workspace_id uuid,p_project_id uuid,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row jsonb;v_project public.projects;v_count_progress integer:=0;v_count_safety integer:=0;v_count_personnel integer:=0;
begin
 if not private.has_project_permission(p_project_id,'data.import') then raise exception 'data.import permission required'; end if;
 select * into v_project from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE';
 if not found then raise exception 'Active Project scope invalid'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce((p_payload->>'format_version')::integer,0)<>1
  or p_payload->>'workspace_id' is distinct from p_workspace_id::text
  or p_payload->>'project_id' is distinct from p_project_id::text
  or (p_payload->>'project' is distinct from v_project.name and p_payload->>'project' is distinct from v_project.project_code
   and p_payload->>'project' is distinct from 'Proyek Cair - UDU') then
  raise exception 'Backup must identify the exact active Project and Workspace';
 end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Import reason required'; end if;
 if jsonb_typeof(coalesce(p_payload->'progress_logs','[]'::jsonb))<>'array'
  or jsonb_typeof(coalesce(p_payload->'safety_reports','[]'::jsonb))<>'array'
  or jsonb_typeof(coalesce(p_payload->'project_personnel','[]'::jsonb))<>'array' then raise exception 'Backup datasets must be arrays'; end if;
 if jsonb_array_length(coalesce(p_payload->'progress_logs','[]'::jsonb))>50000
  or jsonb_array_length(coalesce(p_payload->'safety_reports','[]'::jsonb))>20000
  or jsonb_array_length(coalesce(p_payload->'project_personnel','[]'::jsonb))>10000 then raise exception 'Backup batch size exceeded'; end if;
 if jsonb_array_length(coalesce(p_payload->'progress_logs','[]'::jsonb))>0 and not private.has_project_permission(p_project_id,'progress.create') then raise exception 'progress.create permission required for imported progress'; end if;
 if jsonb_array_length(coalesce(p_payload->'safety_reports','[]'::jsonb))>0 and not private.has_project_permission(p_project_id,'k3.report.create') then raise exception 'k3.report.create permission required for imported K3'; end if;
 if jsonb_array_length(coalesce(p_payload->'project_personnel','[]'::jsonb))>0 and not private.has_project_permission(p_project_id,'personnel.roster.manage') then raise exception 'personnel.roster.manage permission required for imported roster'; end if;
 for v_row in select value from jsonb_array_elements(coalesce(p_payload->'progress_logs','[]'::jsonb)) loop
  if v_row->>'workspace_id'<>p_workspace_id::text or v_row->>'project_id'<>p_project_id::text then raise exception 'Progress backup row has missing or foreign Project scope'; end if;
  if nullif(v_row->>'work_package','') is null or nullif(v_row->>'week_start','') is null or nullif(v_row->>'week_end','') is null then raise exception 'Progress backup row missing required fields'; end if;
  if exists(select 1 from public.progress_logs x where x.client_key=(v_row->>'client_key')::uuid and (x.workspace_id<>p_workspace_id or x.project_id<>p_project_id)) then raise exception 'Progress client_key belongs to another Project'; end if;
  insert into public.progress_logs(id,week_start,week_end,planned_percent,actual_percent,weighted_value,weather_condition,manpower,description,created_by,approved_by,approved_at,status,client_key,work_package,weight_percent,workspace_id,project_id)
  values(coalesce(nullif(v_row->>'id','')::uuid,pg_catalog.gen_random_uuid()),(v_row->>'week_start')::date,(v_row->>'week_end')::date,
   coalesce((v_row->>'planned_percent')::numeric,0),coalesce((v_row->>'actual_percent')::numeric,0),coalesce((v_row->>'weighted_value')::numeric,0),
   v_row->>'weather_condition',coalesce((v_row->>'manpower')::integer,0),coalesce(v_row->>'description','Imported backup'),(select auth.uid()),null,null,'PENDING',
   coalesce(nullif(v_row->>'client_key','')::uuid,pg_catalog.gen_random_uuid()),v_row->>'work_package',coalesce((v_row->>'weight_percent')::numeric,0),p_workspace_id,p_project_id)
  on conflict(client_key) do update set week_start=excluded.week_start,week_end=excluded.week_end,planned_percent=excluded.planned_percent,
   actual_percent=excluded.actual_percent,weighted_value=excluded.weighted_value,weather_condition=excluded.weather_condition,manpower=excluded.manpower,
   description=excluded.description,created_by=(select auth.uid()),approved_by=null,approved_at=null,status='PENDING',work_package=excluded.work_package,
   weight_percent=excluded.weight_percent where progress_logs.workspace_id=p_workspace_id and progress_logs.project_id=p_project_id;
  v_count_progress:=v_count_progress+1;
 end loop;
 for v_row in select value from jsonb_array_elements(coalesce(p_payload->'safety_reports','[]'::jsonb)) loop
  if v_row->>'workspace_id'<>p_workspace_id::text or v_row->>'project_id'<>p_project_id::text then raise exception 'K3 backup row has missing or foreign Project scope'; end if;
  if exists(select 1 from public.safety_reports x where x.client_key=(v_row->>'client_key')::uuid and (x.workspace_id<>p_workspace_id or x.project_id<>p_project_id)) then raise exception 'K3 client_key belongs to another Project'; end if;
  insert into public.safety_reports(id,report_type,report_date,title,severity,description,action_taken,permit_type,location,status,reported_by,reviewed_by,reviewed_at,client_key,workspace_id,project_id)
  values(coalesce(nullif(v_row->>'id','')::uuid,pg_catalog.gen_random_uuid()),v_row->>'report_type',coalesce((v_row->>'report_date')::timestamptz,now()),
   v_row->>'title',v_row->>'severity',v_row->>'description',v_row->>'action_taken',v_row->>'permit_type',v_row->>'location','OPEN',
   (select auth.uid()),null,null,coalesce(nullif(v_row->>'client_key','')::uuid,pg_catalog.gen_random_uuid()),p_workspace_id,p_project_id)
  on conflict(client_key) do update set report_type=excluded.report_type,report_date=excluded.report_date,title=excluded.title,severity=excluded.severity,
   description=excluded.description,action_taken=excluded.action_taken,permit_type=excluded.permit_type,location=excluded.location,status='OPEN',
   reported_by=(select auth.uid()),reviewed_by=null,reviewed_at=null
   where safety_reports.workspace_id=p_workspace_id and safety_reports.project_id=p_project_id;
  v_count_safety:=v_count_safety+1;
 end loop;
 for v_row in select value from jsonb_array_elements(coalesce(p_payload->'project_personnel','[]'::jsonb)) loop
  if v_row->>'workspace_id'<>p_workspace_id::text or v_row->>'project_id'<>p_project_id::text then raise exception 'Roster backup row has missing or foreign Project scope'; end if;
  insert into public.project_personnel(id,full_name,company,job_title,project_role,authority_level,email,phone,linked_user_id,is_active,notes,workspace_id,project_id)
  values(coalesce(nullif(v_row->>'id','')::uuid,pg_catalog.gen_random_uuid()),v_row->>'full_name',v_row->>'company',v_row->>'job_title',
   v_row->>'project_role','NONE',v_row->>'email',v_row->>'phone',null,coalesce((v_row->>'is_active')::boolean,true),v_row->>'notes',p_workspace_id,p_project_id)
  on conflict(id) do update set full_name=excluded.full_name,company=excluded.company,job_title=excluded.job_title,project_role=excluded.project_role,
   authority_level='NONE',email=excluded.email,phone=excluded.phone,linked_user_id=null,is_active=excluded.is_active,notes=excluded.notes
   where project_personnel.workspace_id=p_workspace_id and project_personnel.project_id=p_project_id;
  v_count_personnel:=v_count_personnel+1;
 end loop;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'project.backup.imported','project_backup',null,
  jsonb_build_object('reason',trim(p_reason),'progress_rows',v_count_progress,'safety_rows',v_count_safety,'personnel_rows',v_count_personnel,
   'approval_state_reset_to_pending',true,'identity_links_not_imported',true));
 return jsonb_build_object('progress_rows',v_count_progress,'safety_rows',v_count_safety,'personnel_rows',v_count_personnel);
end $$;

create or replace function public.reverse_cash_transaction_scoped(
 p_workspace_id uuid,p_project_id uuid,p_transaction_id uuid,p_reason text,p_idempotency_key uuid
) returns public.cash_transactions language plpgsql security definer set search_path=''
as $$
declare v_original public.cash_transactions%rowtype;v_reverse public.cash_transactions%rowtype;v_balance numeric;
begin
 if not private.has_project_permission(p_project_id,'cash.transaction.reverse') then raise exception 'cash.transaction.reverse permission required'; end if;
 select * into v_original from public.cash_transactions where id=p_transaction_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found then raise exception 'Cash transaction not found in active Project'; end if;
 if not private.has_project_authority(p_project_id,'cash.transaction.reverse',v_original.amount,'IDR',jsonb_build_object('transaction_category',coalesce(v_original.category,'Lainnya'))) then raise exception 'Cash reversal Authority/limit scope required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or p_idempotency_key is null then raise exception 'Correction reason and idempotency key are required'; end if;
 if exists(select 1 from public.cash_transaction_reversals where original_transaction_id=p_transaction_id) then raise exception 'Cash transaction has already been reversed'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,824631905177));
 select coalesce(sum(case when transaction_type='MASUK' then amount else -amount end),0) into v_balance from public.cash_transactions where workspace_id=p_workspace_id and project_id=p_project_id;
 if v_original.transaction_type='MASUK' and v_balance<v_original.amount then raise exception 'Insufficient cash balance to reverse original inflow'; end if;
 insert into public.cash_transactions(idempotency_key,transaction_type,amount,occurred_at,category,description,reference_no,pic,notes,created_by,workspace_id,project_id)
 values(p_idempotency_key,case v_original.transaction_type when 'MASUK' then 'KELUAR' else 'MASUK' end,v_original.amount,now(),
  v_original.category,'Pembalikan transaksi: '||v_original.description,'REV-'||coalesce(v_original.reference_no,v_original.id::text),
  v_original.pic,trim(p_reason),(select auth.uid()),p_workspace_id,p_project_id) returning * into v_reverse;
 insert into public.cash_transaction_reversals(original_transaction_id,reversal_transaction_id,reason,reversed_by,workspace_id,project_id)
 values(v_original.id,v_reverse.id,trim(p_reason),(select auth.uid()),p_workspace_id,p_project_id);
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'cash.transaction.reversed','cash_transaction',v_original.id::text,
  jsonb_build_object('reversal_id',v_reverse.id,'amount',v_original.amount,'reason',trim(p_reason)));
 return v_reverse;
end $$;

create or replace function public.create_workflow_definition_scoped(
 p_workspace_id uuid,p_project_id uuid,p_process_type text,p_display_name text,p_permission_code text,
 p_authority_code text,p_required_role_codes text[],p_sla_business_days integer,p_timezone text,p_reason text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_company uuid;v_version integer;v_roles text[];v_requires_authority boolean;v_authority_code text;
begin
 if not (private.has_project_permission(p_project_id,'workflow.definition.create') or private.has_project_permission(p_project_id,'workflow.definition.update')) then raise exception 'workflow.definition.create/update permission required'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE') then raise exception 'Project scope invalid'; end if;
 if p_process_type not in ('BOQ','DOCUMENT','CASH','INVENTORY','PROGRESS','K3','PROCUREMENT') then raise exception 'Unsupported workflow process'; end if;
 if length(trim(coalesce(p_display_name,'')))<3 or p_sla_business_days is null or p_sla_business_days not between 1 and 90 or length(trim(coalesce(p_reason,'')))<8 then raise exception 'Definition name, SLA and reason are required'; end if;
 if not (
  (p_process_type='BOQ' and p_permission_code in ('boq.review','boq.approve')) or
  (p_process_type='DOCUMENT' and p_permission_code in ('document.review','document.approve')) or
  (p_process_type='CASH' and p_permission_code in ('cash.transaction.review','cash.transaction.approve')) or
  (p_process_type='INVENTORY' and p_permission_code in ('inventory.movement.review','inventory.movement.approve')) or
  (p_process_type='PROGRESS' and p_permission_code in ('progress.review','progress.verify','progress.approve')) or
  (p_process_type='K3' and p_permission_code in ('k3.report.review','k3.report.close')) or
  (p_process_type='PROCUREMENT' and p_permission_code in ('procurement.review','procurement.approve'))
 ) then raise exception 'Process and action permission mismatch'; end if;
 select requires_authority_check into v_requires_authority from public.project_permission_catalog where permission_code=p_permission_code and active;
 if not found then raise exception 'Workflow action permission is inactive'; end if;
 if v_requires_authority and p_authority_code is distinct from p_permission_code then raise exception 'Authority code must match the authority-gated action permission'; end if;
 v_authority_code:=case when v_requires_authority then p_permission_code else null end;
 select coalesce(array_agg(distinct x),'{}') into v_roles from unnest(coalesce(p_required_role_codes,'{}')) x;
 if exists(select 1 from unnest(v_roles) r where not exists(select 1 from public.role_catalog c where c.role_code=r and c.active)) then raise exception 'Unknown or inactive required Role'; end if;
 select company_id into v_company from public.projects where id=p_project_id;
 select coalesce(max(version),0)+1 into v_version from public.workflow_definitions where project_id=p_project_id and process_type=p_process_type;
 update public.workflow_definitions set active=false where project_id=p_project_id and process_type=p_process_type and active;
 insert into public.workflow_definitions(company_id,workspace_id,project_id,process_type,display_name,version,step_templates,sla_business_days,timezone,active,created_by)
 values(v_company,p_workspace_id,p_project_id,p_process_type,trim(p_display_name),v_version,
  jsonb_build_array(jsonb_build_object('step_order',1,'permission_code',p_permission_code,'authority_code',v_authority_code,'required_role_codes',v_roles)),
  p_sla_business_days,coalesce(nullif(trim(p_timezone),''),'Asia/Jakarta'),true,(select auth.uid())) returning id into v_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'workflow.definition.created','workflow_definition',v_id::text,
  jsonb_build_object('process_type',p_process_type,'version',v_version,'permission_code',p_permission_code,'authority_code',v_authority_code,'required_role_codes',v_roles,'sla_business_days',p_sla_business_days,'reason',trim(p_reason)));
 return v_id;
end $$;


-- Multi-stage workflow definitions: each ordered step owns its action permission and role gate.
alter table public.workflow_steps add column if not exists display_name text not null default 'Tahap';

create or replace function public.create_workflow_definition_steps_scoped(
 p_workspace_id uuid,p_project_id uuid,p_process_type text,p_display_name text,p_step_templates jsonb,
 p_sla_business_days integer,p_timezone text,p_reason text
) returns uuid language plpgsql security definer set search_path=''
as $wfbody8$
declare
 v_id uuid;v_company uuid;v_version integer;v_step jsonb;v_step_order integer;v_permission text;
 v_authority text;v_requires_authority boolean;v_roles jsonb;v_role text;v_label text;
 v_normalized jsonb:='[]'::jsonb;v_timezone text;
begin
 if v_permission is null or not (private.has_project_permission(p_project_id,'workflow.definition.create') or private.has_project_permission(p_project_id,'workflow.definition.update')) then
  raise exception 'workflow.definition.create/update permission required';
 end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id and p.status='ACTIVE') then
  raise exception 'Project scope invalid';
 end if;
 if p_process_type is null or p_process_type not in ('BOQ','DOCUMENT','CASH','INVENTORY','PROGRESS','K3','PROCUREMENT') then
  raise exception 'Unsupported workflow process';
 end if;
 if length(trim(coalesce(p_display_name,'')))<3 or p_sla_business_days is null or p_sla_business_days not between 1 and 90
  or length(trim(coalesce(p_reason,'')))<8 then
  raise exception 'Definition name, SLA and reason are required';
 end if;
 if p_step_templates is null or jsonb_typeof(p_step_templates)<>'array' or jsonb_array_length(p_step_templates) not between 1 and 20 then
  raise exception 'Workflow definition requires 1-20 ordered step templates';
 end if;
 v_timezone:=coalesce(nullif(trim(p_timezone),''),'Asia/Jakarta');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
  raise exception 'Unknown workflow timezone';
 end if;
 for v_step,v_step_order in
  select x.value,x.ordinality::integer from jsonb_array_elements(p_step_templates) with ordinality x(value,ordinality) order by x.ordinality
 loop
  if jsonb_typeof(v_step) is distinct from 'object' then raise exception 'Each workflow step template must be an object'; end if;
  if v_step ? 'step_order' and (v_step->>'step_order')::integer<>v_step_order then
   raise exception 'Workflow step_order must be contiguous and match array order';
  end if;
  v_permission:=v_step->>'permission_code';
  if not (
   (p_process_type='BOQ' and v_permission in ('boq.review','boq.approve')) or
   (p_process_type='DOCUMENT' and v_permission in ('document.review','document.approve')) or
   (p_process_type='CASH' and v_permission in ('cash.transaction.review','cash.transaction.approve')) or
   (p_process_type='INVENTORY' and v_permission in ('inventory.movement.review','inventory.movement.approve')) or
   (p_process_type='PROGRESS' and v_permission in ('progress.review','progress.verify','progress.approve')) or
   (p_process_type='K3' and v_permission in ('k3.report.review','k3.report.close')) or
   (p_process_type='PROCUREMENT' and v_permission in ('procurement.review','procurement.approve'))
  ) then raise exception 'Process and step action permission mismatch at step %',v_step_order; end if;
  select requires_authority_check into v_requires_authority
  from public.project_permission_catalog where permission_code=v_permission and active;
  if not found then raise exception 'Workflow step permission is inactive: %',v_permission; end if;
  v_authority:=case when v_requires_authority then v_permission else null end;
  v_roles:=coalesce(v_step->'required_role_codes','[]'::jsonb);
  if jsonb_typeof(v_roles) is distinct from 'array' then raise exception 'required_role_codes must be an array at step %',v_step_order; end if;
  for v_role in select value from jsonb_array_elements_text(v_roles) as r(value) loop
   if not exists(select 1 from public.role_catalog c where c.role_code=v_role and c.active) then
    raise exception 'Unknown or inactive required Role at step %: %',v_step_order,v_role;
   end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(role_code) order by role_code),'[]'::jsonb) into v_roles
  from (select distinct value as role_code from jsonb_array_elements_text(v_roles) as r(value)) roles;
  v_label:=coalesce(nullif(trim(v_step->>'display_name'),''),'Tahap '||v_step_order::text);
  if length(v_label)>80 then raise exception 'Workflow step label is too long'; end if;
  v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object(
   'step_order',v_step_order,'display_name',v_label,'permission_code',v_permission,
   'authority_code',v_authority,'required_role_codes',v_roles));
 end loop;
 select company_id into v_company from public.projects where id=p_project_id;
 select coalesce(max(version),0)+1 into v_version from public.workflow_definitions
 where project_id=p_project_id and process_type=p_process_type;
 update public.workflow_definitions set active=false where project_id=p_project_id and process_type=p_process_type and active;
 insert into public.workflow_definitions(company_id,workspace_id,project_id,process_type,display_name,version,step_templates,sla_business_days,timezone,active,created_by)
 values(v_company,p_workspace_id,p_project_id,p_process_type,trim(p_display_name),v_version,v_normalized,p_sla_business_days,v_timezone,true,(select auth.uid()))
 returning id into v_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'workflow.definition.created','workflow_definition',v_id::text,
  jsonb_build_object('process_type',p_process_type,'version',v_version,'step_templates',v_normalized,
   'sla_business_days',p_sla_business_days,'timezone',v_timezone,'reason',trim(p_reason)));
 return v_id;
end $wfbody8$;

create or replace function private.start_project_workflow_steps(
 p_project_id uuid,p_process_type text,p_resource_type text,p_resource_id uuid,p_resource_version text,
 p_step_assignments jsonb,p_sla_business_days integer,p_timezone text,p_definition_id uuid,
 p_definition_version integer,p_reason text,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $wfbody9$
declare
 v_project public.projects;v_company uuid;v_workspace uuid;v_id uuid;v_step_record jsonb;
 v_step_order integer:=0;v_expected_step integer:=1;v_user uuid;v_permission text;v_authority text;
 v_requires_authority boolean;v_roles jsonb;v_role text;v_label text;v_amount numeric;v_currency text:='IDR';
 v_scope jsonb:='{}'::jsonb;v_resource_snapshot jsonb;v_resource_hash text;v_due timestamptz;
 v_approver_ids uuid[]:='{}'::uuid[];v_snapshot_steps jsonb:='[]'::jsonb;v_timezone text;v_existing public.workflow_instances;
begin
 select p.* into v_project from public.projects p where p.id=p_project_id and p.status='ACTIVE';
 if not found or not private.has_project_permission(p_project_id,'workflow.start') then
  raise exception 'Workflow start permission required';
 end if;
 if p_resource_type not in ('BOQ','PROGRESS','PROCUREMENT','INVENTORY','CASH','K3','DOCUMENT')
  or p_resource_type is distinct from p_process_type or p_resource_id is null then
  raise exception 'Unsupported workflow resource/process combination';
 end if;
 if p_step_assignments is null or jsonb_typeof(p_step_assignments)<>'array' or jsonb_array_length(p_step_assignments) not between 1 and 20 then
  raise exception 'Workflow requires 1-20 ordered approver assignments';
 end if;
 if p_idempotency_key is null or p_sla_business_days is null or p_sla_business_days not between 1 and 90 or length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then
  raise exception 'Idempotency key and valid SLA are required';
 end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text||p_idempotency_key::text,0));
 v_timezone:=coalesce(nullif(trim(p_timezone),''),'Asia/Jakarta');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'Unknown workflow timezone'; end if;
 if exists(
  select 1 from (select (x.value->>'user_id')::uuid as user_id from jsonb_array_elements(p_step_assignments) x(value)) a
  group by a.user_id having count(*)>1
 ) then raise exception 'Duplicate approver in serial chain'; end if;
 select w.company_id,w.id into v_company,v_workspace from public.workspaces w where w.id=v_project.workspace_id;

 -- Capture canonical resource facts and the server-derived immutable snapshot.
  -- Lock and snapshot the canonical resource before reading authority amount/category facts.
  -- This prevents a concurrent update from changing the resource between amount validation and hash capture.
  v_resource_snapshot:=private.workflow_resource_snapshot(p_project_id,p_resource_type,p_resource_id);
  if v_resource_snapshot is null then raise exception 'Workflow resource disappeared or is outside the selected Project'; end if;
 if p_resource_type='DOCUMENT' and not exists(select 1 from public.documents d where d.id=p_resource_id and d.project_id=p_project_id and d.status='DRAFT' and d.lifecycle_status='ACTIVE' and d.revoked_at is null) then
  raise exception 'Only an active DRAFT document can enter a new approval workflow';
 end if;
 if p_resource_type='CASH' then
  select ct.amount,'IDR',jsonb_build_object('transaction_category',coalesce(ct.category,ct.transaction_type),'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.cash_transactions ct where ct.id=p_resource_id and ct.project_id=p_project_id;
 elsif p_resource_type='PROCUREMENT' then
  select coalesce(sum(ri.quantity*ri.unit_price),0),r.currency,jsonb_build_object('transaction_category','PROCUREMENT','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.procurement_requests r
   left join public.procurement_request_items ri on ri.request_id=r.id
   where r.id=p_resource_id and r.project_id=p_project_id group by r.id;
 elsif p_resource_type='BOQ' then
  select ba.quantity*ba.unit_rate,'IDR',jsonb_build_object('transaction_category','BOQ_ADDITION','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.boq_additions ba where ba.id=p_resource_id and ba.project_id=p_project_id;
  if not found then
   select bi.quantity*coalesce(bi.baseline_unit_rate,bi.unit_rate),'IDR',jsonb_build_object('transaction_category','BOQ','workflow_stage','APPROVAL')
    into v_amount,v_currency,v_scope from public.boq_items bi where bi.id=p_resource_id and bi.project_id=p_project_id;
  end if;
 elsif p_resource_type='INVENTORY' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category',it.transaction_type,'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.inventory_transactions it where it.id=p_resource_id and it.project_id=p_project_id;
 elsif p_resource_type='DOCUMENT' then
  select d.amount_summary,'IDR',jsonb_build_object('document_type',d.document_type,'workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.documents d where d.id=p_resource_id and d.project_id=p_project_id;
 elsif p_resource_type='PROGRESS' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category','PROGRESS','workflow_stage','APPROVAL')
   into v_amount,v_currency,v_scope from public.progress_logs p where p.id=p_resource_id and p.project_id=p_project_id;
 elsif p_resource_type='K3' then
  select null::numeric,'IDR',jsonb_build_object('transaction_category',coalesce(sr.report_type,'K3'),'workflow_stage','REVIEW')
   into v_amount,v_currency,v_scope from public.safety_reports sr where sr.id=p_resource_id and sr.project_id=p_project_id;
 end if;
 if not found then raise exception 'Workflow resource does not exist in the selected Project'; end if;
 v_scope:=coalesce(v_scope,'{}'::jsonb);
 v_resource_hash:=encode(extensions.digest(v_resource_snapshot::text,'sha256'),'hex');

 for v_step_record in select value from jsonb_array_elements(p_step_assignments) as x(value) loop
  v_step_order:=v_step_order+1;
  if jsonb_typeof(v_step_record) is distinct from 'object' or coalesce((v_step_record->>'step_order')::integer,0)<>v_step_order then
   raise exception 'Workflow step assignments must have contiguous step_order values';
  end if;
  v_user:=(v_step_record->>'user_id')::uuid;
  v_permission:=v_step_record->>'permission_code';
  v_label:=coalesce(nullif(trim(v_step_record->>'display_name'),''),'Tahap '||v_step_order::text);
  if length(v_label)>80 then raise exception 'Workflow step label is too long'; end if;
  if not (
   (p_process_type='BOQ' and v_permission in ('boq.review','boq.approve')) or
   (p_process_type='DOCUMENT' and v_permission in ('document.review','document.approve')) or
   (p_process_type='CASH' and v_permission in ('cash.transaction.review','cash.transaction.approve')) or
   (p_process_type='INVENTORY' and v_permission in ('inventory.movement.review','inventory.movement.approve')) or
   (p_process_type='PROGRESS' and v_permission in ('progress.review','progress.verify','progress.approve')) or
   (p_process_type='K3' and v_permission in ('k3.report.review','k3.report.close')) or
   (p_process_type='PROCUREMENT' and v_permission in ('procurement.review','procurement.approve'))
  ) then raise exception 'Process and step action permission mismatch at step %',v_step_order; end if;
  select requires_authority_check into v_requires_authority
   from public.project_permission_catalog where permission_code=v_permission and active;
  if not found then raise exception 'Workflow step permission is inactive: %',v_permission; end if;
  v_authority:=case when v_requires_authority then v_permission else null end;
  if not private.user_has_project_permission(v_user,p_project_id,v_permission)
   or not private.user_has_project_permission(v_user,p_project_id,'workflow.step.act') then
   raise exception 'Approver at step % lacks active membership, Persona, action permission or workflow.step.act',v_step_order;
  end if;
  v_roles:=coalesce(v_step_record->'required_role_codes','[]'::jsonb);
  if jsonb_typeof(v_roles)<>'array' then raise exception 'Required Role list must be an array at step %',v_step_order; end if;
  if jsonb_array_length(v_roles)>0 and not exists(
   select 1 from public.project_memberships pm
   join public.company_membership_role_assignments ra on ra.company_membership_id=pm.company_membership_id
   where pm.project_id=p_project_id and pm.user_id=v_user and pm.membership_status='ACTIVE'
    and ra.role_code in (select value from jsonb_array_elements_text(v_roles) as r(value))
    and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
  ) then raise exception 'Approver at step % does not match any required Role',v_step_order; end if;
  if v_authority is not null and not exists(
   select 1 from public.project_memberships pm
   join public.company_memberships cm on cm.id=pm.company_membership_id and cm.membership_status='ACTIVE'
   join public.company_membership_authority_assignments aa on aa.company_membership_id=cm.id
   where pm.project_id=p_project_id and pm.user_id=v_user and pm.membership_status='ACTIVE'
    and aa.project_id=p_project_id and aa.authority_code=v_authority and aa.revoked_at is null
    and aa.starts_at<=now() and (aa.ends_at is null or aa.ends_at>now())
    and (aa.max_amount is null or (v_amount is not null and aa.max_amount>=v_amount and aa.currency=v_currency))
    and (aa.scope='{}'::jsonb or v_scope @> aa.scope)
  ) then raise exception 'Approver at step % lacks matching Authority or sufficient limit/scope',v_step_order; end if;
  if (select auth.uid())=v_user and p_process_type in ('CASH','DOCUMENT') then
   raise exception 'Self approval is prohibited for cash and formal documents';
  end if;
  v_approver_ids:=array_append(v_approver_ids,v_user);
  v_snapshot_steps:=v_snapshot_steps||jsonb_build_array(jsonb_build_object(
   'step_order',v_step_order,'display_name',v_label,'user_id',v_user,'permission_code',v_permission,'authority_code',v_authority,
   'required_role_codes',v_roles,'authority_amount',v_amount,'authority_currency',v_currency,'authority_scope',v_scope));
 end loop;

 insert into public.workflow_instances(company_id,workspace_id,project_id,definition_id,process_type,resource_type,resource_id,
  resource_version,initiated_by,idempotency_key,authority_amount,authority_currency,authority_scope,snapshot)
 values(v_company,v_workspace,p_project_id,p_definition_id,p_process_type,p_resource_type,p_resource_id,v_resource_hash,
  (select auth.uid()),p_idempotency_key,v_amount,v_currency,v_scope,
  jsonb_build_object('approvers',v_approver_ids,'steps',v_snapshot_steps,'definition_id',p_definition_id,
   'definition_version',p_definition_version,'sla_business_days',p_sla_business_days,'timezone',v_timezone,'reason',trim(p_reason),
   'authority_amount',v_amount,'authority_currency',v_currency,'authority_scope',v_scope,
   'resource_snapshot',v_resource_snapshot,'client_resource_version',p_resource_version))
 on conflict(project_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
   select * into v_existing from public.workflow_instances where project_id=p_project_id and idempotency_key=p_idempotency_key;
   if not found or v_existing.initiated_by is distinct from (select auth.uid())
    or v_existing.definition_id is distinct from p_definition_id
    or v_existing.process_type is distinct from p_process_type or v_existing.resource_type is distinct from p_resource_type
    or v_existing.resource_id is distinct from p_resource_id or v_existing.resource_version is distinct from v_resource_hash
    or v_existing.snapshot->>'definition_id' is distinct from p_definition_id::text
    or v_existing.snapshot->>'definition_version' is distinct from p_definition_version::text
    or v_existing.snapshot->>'sla_business_days' is distinct from p_sla_business_days::text
    or v_existing.snapshot->>'timezone' is distinct from v_timezone
     or v_existing.snapshot->>'reason' is distinct from trim(p_reason)
    or v_existing.snapshot->'approvers' is distinct from to_jsonb(v_approver_ids)
    or v_existing.snapshot->'steps' is distinct from v_snapshot_steps
    or v_existing.snapshot->>'client_resource_version' is distinct from p_resource_version
    or v_existing.authority_amount is distinct from v_amount
    or v_existing.authority_currency is distinct from v_currency
    or v_existing.authority_scope is distinct from v_scope then
    raise exception 'IDEMPOTENCY_KEY_REUSED: this key already belongs to a different workflow request';
   end if;
   return v_existing.id;
  end if;
 v_step_order:=0;
 for v_step_record in select value from jsonb_array_elements(p_step_assignments) as x(value) loop
  v_step_order:=v_step_order+1;
  v_user:=(v_step_record->>'user_id')::uuid;
  v_permission:=v_step_record->>'permission_code';
  v_label:=coalesce(nullif(trim(v_step_record->>'display_name'),''),'Tahap '||v_step_order::text);
  select requires_authority_check into v_requires_authority
   from public.project_permission_catalog where permission_code=v_permission and active;
  v_authority:=case when v_requires_authority then v_permission else null end;
  v_due:=case when v_step_order=1 then private.add_business_days(now(),p_sla_business_days,v_timezone,v_workspace) else null end;
  insert into public.workflow_steps(workflow_id,step_order,display_name,assignee_user_id,permission_code,authority_code,status,due_at)
  values(v_id,v_step_order,v_label,v_user,v_permission,v_authority,case when v_step_order=1 then 'ACTIVE' else 'PENDING' end,v_due);
  insert into public.user_notifications(user_id,workspace_id,project_id,notification_type,title,body,reference_type,reference_id)
  values(v_user,v_workspace,p_project_id,
   case when v_step_order=1 then 'WORKFLOW_STEP_ASSIGNED' else 'WORKFLOW_STEP_SCHEDULED' end,
   case when v_step_order=1 then 'Tugas approval baru' else 'Tahap approval terjadwal' end,
   case when v_step_order=1 then 'Anda ditetapkan sebagai approver aktif untuk permission '||v_permission||'.'
    else 'Anda termasuk dalam rantai approval serial; tahap Anda aktif setelah tahap sebelumnya selesai ('||v_permission||').' end,
   'workflow',v_id);
 end loop;
 insert into public.workflow_events(workflow_id,actor_id,event_type,to_status,details)
 values(v_id,(select auth.uid()),'WORKFLOW_STARTED','ACTIVE',
  jsonb_build_object('approver_count',cardinality(v_approver_ids),'step_templates',v_snapshot_steps,'reason',trim(p_reason),
   'authority_amount',v_amount,'authority_currency',v_currency,'authority_scope',v_scope));
 return v_id;
end $wfbody9$;

revoke all on function private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid) from public,anon,authenticated;

create or replace function public.start_project_workflow_from_definition(
 p_project_id uuid,p_definition_id uuid,p_resource_id uuid,p_resource_version text,p_approver_ids uuid[],p_reason text,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $wfbody10$
declare v_def public.workflow_definitions;v_template jsonb;v_assignments jsonb:='[]'::jsonb;v_i integer;v_template_count integer;
begin
 select * into v_def from public.workflow_definitions where id=p_definition_id and project_id=p_project_id and active;
 if not found then raise exception 'Active workflow definition not found in this Project'; end if;
  if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Workflow start reason must contain 8-500 characters'; end if;
 if coalesce(cardinality(p_approver_ids),0)<1 or cardinality(p_approver_ids)>20 then
  raise exception 'Approver chain must contain 1-20 users';
 end if;
 v_template_count:=jsonb_array_length(v_def.step_templates);
 if v_template_count>1 and cardinality(p_approver_ids)<>v_template_count then
  raise exception 'Select exactly one approver for each configured workflow step';
 end if;
 for v_i in 1..cardinality(p_approver_ids) loop
  v_template:=case when v_template_count=1 then v_def.step_templates->0 else v_def.step_templates->(v_i-1) end;
  v_assignments:=v_assignments||jsonb_build_array(jsonb_build_object(
   'step_order',v_i,'display_name',coalesce(v_template->>'display_name','Tahap '||v_i::text),
   'user_id',p_approver_ids[v_i],'permission_code',v_template->>'permission_code',
   'required_role_codes',coalesce(v_template->'required_role_codes','[]'::jsonb)));
 end loop;
 return private.start_project_workflow_steps(
  p_project_id,v_def.process_type,v_def.process_type,p_resource_id,p_resource_version,v_assignments,
  v_def.sla_business_days,v_def.timezone,v_def.id,v_def.version,p_reason,p_idempotency_key);
end $wfbody10$;


create or replace function private.revoke_project_signatory_appointment(p_appointment_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $signatoryrevoke$
declare v public.project_signatory_appointments;
begin
 select * into v from public.project_signatory_appointments where id=p_appointment_id;
 if not found or not private.is_company_super_admin(v.workspace_id) then raise exception 'Company Super Admin required for signatory revocation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v.project_id::text||':'||v.document_type,0));
 select * into v from public.project_signatory_appointments where id=p_appointment_id for update;
 if not found or v.status<>'ACTIVE' then raise exception 'Only active signatory appointment can be revoked'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Revocation reason must contain 8-500 characters'; end if;
 update public.project_signatory_appointments set status='REVOKED',revoked_at=now(),revoked_by=(select auth.uid()),revocation_reason=trim(p_reason) where id=p_appointment_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v.workspace_id,v.project_id,'project.signatory.revoked','signatory_appointment',p_appointment_id::text,
  jsonb_build_object('user_id',v.user_id,'document_type',v.document_type,'reason',trim(p_reason)));
end
$signatoryrevoke$;

create or replace function public.revoke_project_signatory_appointment(p_appointment_id uuid,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.revoke_project_signatory_appointment(p_appointment_id,p_reason); $$;

create or replace function public.submit_procurement_request_scoped(p_workspace_id uuid,p_project_id uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.procurement_requests;
begin
 if not private.has_project_permission(p_project_id,'procurement.submit') then raise exception 'procurement.submit permission required'; end if;
 select * into v from public.procurement_requests where id=p_request_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found then raise exception 'Procurement request not found'; end if;
 if v.status='SUBMITTED' then return; end if;
 if v.status<>'DRAFT' then raise exception 'Only draft procurement requests can be submitted'; end if;
 update public.procurement_requests set status='SUBMITTED',submitted_at=now(),updated_at=now() where id=p_request_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'procurement.request.submitted','procurement_request',p_request_id::text,'{}'::jsonb);
end $$;

create or replace function public.issue_procurement_order_scoped(p_workspace_id uuid,p_project_id uuid,p_request_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v public.procurement_requests;v_id uuid;v_no text;v_total numeric;
begin
 if not private.has_project_permission(p_project_id,'procurement.issue_order') then raise exception 'procurement.issue_order permission required'; end if;
 select * into v from public.procurement_requests where id=p_request_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
 if not found then raise exception 'Procurement request not found'; end if;
 if v.status='ORDERED' then select id into v_id from public.procurement_orders where request_id=p_request_id; if v_id is not null then return v_id; end if; raise exception 'Ordered request is missing its Purchase Order'; end if;
 if v.status<>'APPROVED' then raise exception 'Only an approved procurement request can become an order'; end if;
 select coalesce(sum(quantity*unit_price),0) into v_total from public.procurement_request_items where request_id=p_request_id;
 if not private.has_project_authority(p_project_id,'procurement.issue_order',v_total,v.currency,jsonb_build_object('transaction_category','PROCUREMENT')) then raise exception 'procurement.issue_order Authority scope required'; end if;
 if not exists(select 1 from public.workflow_instances w where w.project_id=p_project_id and w.resource_type='PROCUREMENT' and w.resource_id=p_request_id and w.status='COMPLETED') then raise exception 'Completed approval workflow required'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Purchase order issue reason must be 8-500 characters'; end if;
 v_no:='PO-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(encode(extensions.gen_random_bytes(4),'hex'),1,8));
 insert into public.procurement_orders(workspace_id,project_id,request_id,po_no,supplier_name,currency,total_amount,issued_by)
 values(p_workspace_id,p_project_id,p_request_id,v_no,v.supplier_name,v.currency,v_total,(select auth.uid())) returning id into v_id;
 insert into public.procurement_order_items(order_id,workspace_id,project_id,request_item_id,item_id,description,ordered_quantity,uom,unit_price)
 select v_id,p_workspace_id,p_project_id,id,item_id,description,quantity,uom,unit_price from public.procurement_request_items where request_id=p_request_id;
 update public.procurement_requests set status='ORDERED',updated_at=now() where id=p_request_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'procurement.order.issued','procurement_order',v_id::text,jsonb_build_object('request_id',p_request_id,'reason',trim(p_reason),'total',v_total));
 return v_id;
end $$;

drop function if exists public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb);
create or replace function public.receive_procurement_order_scoped(
 p_workspace_id uuid,p_project_id uuid,p_order_id uuid,p_reference_no text,p_notes text,p_items jsonb,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $grcreate$
declare
 v_order public.procurement_orders;v_id uuid;v_item jsonb;v_line public.procurement_order_items;
 v_qty numeric;v_rejected numeric;v_no text;v_tx uuid;v_amount numeric;v_hash text;v_existing public.goods_receipts;
begin
 if not private.has_project_permission(p_project_id,'procurement.receive') then raise exception 'procurement.receive permission required'; end if;
 if not private.has_project_permission(p_project_id,'inventory.movement.create') then raise exception 'inventory.movement.create permission required to post accepted goods to stock'; end if;
 if p_idempotency_key is null or p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
  raise exception 'Receipt idempotency key and one or more receipt lines are required';
 end if;
 if length(trim(coalesce(p_reference_no,'')))>160 or length(trim(coalesce(p_notes,'')))>2000 then raise exception 'Receipt reference or notes exceed allowed length'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'order_item_id' having count(*)>1) then raise exception 'Duplicate receipt order lines are not allowed'; end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('order_id',p_order_id,'reference_no',nullif(trim(p_reference_no),''),'notes',nullif(trim(p_notes),''),'items',p_items)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text||p_idempotency_key::text,0));
 select * into v_existing from public.goods_receipts where project_id=p_project_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_existing.received_by is distinct from (select auth.uid()) or v_existing.order_id is distinct from p_order_id or v_existing.request_hash is distinct from v_hash then
   raise exception 'IDEMPOTENCY_KEY_REUSED: goods receipt key belongs to a different payload';
  end if;
  return v_existing.id;
 end if;
 select * into v_order from public.procurement_orders where id=p_order_id and workspace_id=p_workspace_id and project_id=p_project_id and status in ('ISSUED','PARTIALLY_RECEIVED') for update;
 if not found then raise exception 'Order unavailable or already fully received'; end if;
 select coalesce(sum((x->>'accepted_quantity')::numeric*oi.unit_price),0) into v_amount
 from jsonb_array_elements(p_items) x join public.procurement_order_items oi on oi.id=(x->>'order_item_id')::uuid and oi.order_id=p_order_id;
 if not private.has_project_authority(p_project_id,'procurement.receive',v_amount,v_order.currency,jsonb_build_object('transaction_category','PROCUREMENT')) then
  raise exception 'procurement.receive Authority scope required';
 end if;
 v_no:='GR-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,8));
 insert into public.goods_receipts(workspace_id,project_id,order_id,receipt_no,received_by,reference_no,notes,idempotency_key,request_hash)
 values(p_workspace_id,p_project_id,p_order_id,v_no,(select auth.uid()),nullif(trim(p_reference_no),''),nullif(trim(p_notes),''),p_idempotency_key,v_hash)
 returning id into v_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_line from public.procurement_order_items where id=(v_item->>'order_item_id')::uuid and order_id=p_order_id for update;
  if not found then raise exception 'Receipt line does not belong to purchase order'; end if;
  v_qty:=coalesce(nullif(v_item->>'accepted_quantity','')::numeric,0);
  v_rejected:=coalesce(nullif(v_item->>'rejected_quantity','')::numeric,0);
  if v_qty<0 or v_rejected<0 or v_qty+v_rejected<=0
   or v_line.received_quantity+v_qty+v_rejected>v_line.ordered_quantity then
   raise exception 'Accepted/rejected receipt quantity exceeds remaining ordered quantity';
  end if;
  insert into public.goods_receipt_items(receipt_id,order_item_id,item_id,accepted_quantity,rejected_quantity,uom)
  values(v_id,v_line.id,v_line.item_id,v_qty,v_rejected,v_line.uom);
  update public.procurement_order_items set received_quantity=received_quantity+v_qty where id=v_line.id;
  if v_qty>0 then
   insert into public.inventory_transactions(idempotency_key,item_id,transaction_type,quantity,uom,occurred_at,reference_no,counterparty,location,notes,created_by,source_name,destination_name,recipient_name,owner_type,purpose,workspace_id,project_id)
   values(extensions.gen_random_uuid(),v_line.item_id,'MASUK',v_qty,v_line.uom,now(),v_no,v_order.supplier_name,'Gudang proyek',nullif(trim(p_notes),''),(select auth.uid()),
    v_order.supplier_name,'Gudang proyek','Penerimaan procurement','KONTRAKTOR','Goods receipt '||v_no,p_workspace_id,p_project_id)
   returning id into v_tx;
  end if;
 end loop;
 update public.procurement_orders set status=case when not exists(select 1 from public.procurement_order_items where order_id=p_order_id and received_quantity<ordered_quantity) then 'RECEIVED' else 'PARTIALLY_RECEIVED' end where id=p_order_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,p_project_id,'procurement.goods_received','goods_receipt',v_id::text,
  jsonb_build_object('order_id',p_order_id,'reference_no',p_reference_no,'items',p_items,'idempotency_key',p_idempotency_key));
 return v_id;
end $grcreate$;

revoke all on table public.workspace_business_holidays from anon,authenticated;
grant select on table public.workspace_business_holidays to authenticated;

-- Least-privilege grants and revocations
revoke all on function private.workflow_resource_snapshot(uuid,text,uuid) from public,anon,authenticated;
revoke all on function private.has_company_member_permission(uuid,uuid,text) from public,anon,authenticated;

revoke insert,update,delete on public.document_signatures from public,anon,authenticated;
revoke all on function private.has_project_authority(uuid,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function private.has_project_authority(uuid,text,numeric,text,jsonb) to authenticated;
revoke all on function private.list_company_members_for_console(uuid) from public,anon,authenticated;
grant execute on function private.list_company_members_for_console(uuid) to authenticated;
revoke all on function private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) from public,anon,authenticated;
grant execute on function private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) to authenticated;
revoke all on function private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) to authenticated;
revoke all on function private.can_read_workflow(uuid) from public,anon,authenticated;
grant execute on function private.can_read_workflow(uuid) to authenticated;
drop function if exists public.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid);
drop function if exists private.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid);
drop function if exists public.act_project_workflow_step(uuid,uuid,text,text,integer);
drop function if exists private.act_project_workflow_step(uuid,uuid,text,text,integer);
revoke all on function private.act_project_workflow_step(uuid,uuid,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function private.act_project_workflow_step(uuid,uuid,text,text,integer,uuid) to authenticated;
revoke all on function public.act_project_workflow_step(uuid,uuid,text,text,integer,uuid) from public,anon;
grant execute on function public.act_project_workflow_step(uuid,uuid,text,text,integer,uuid) to authenticated;
revoke all on function private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) to authenticated;
revoke all on function private.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) to authenticated;
revoke all on function private.has_project_permission(uuid,text) from public,anon;
grant execute on function private.has_project_permission(uuid,text) to authenticated;
revoke all on function private.set_role_permission_mapping(text,text,boolean,text) from public,anon,authenticated;
grant execute on function private.set_role_permission_mapping(text,text,boolean,text) to authenticated;
revoke all on function public.set_role_permission_mapping(text,text,boolean,text) from public,anon;
grant execute on function public.set_role_permission_mapping(text,text,boolean,text) to authenticated;
revoke all on function private.preview_company_access_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.preview_company_access_snapshot(uuid,jsonb) to authenticated;
revoke all on function public.preview_company_access_snapshot(uuid,jsonb) from public,anon;
grant execute on function public.preview_company_access_snapshot(uuid,jsonb) to authenticated;
revoke all on function private.set_my_active_persona(uuid,text) from public,anon,authenticated;
grant execute on function private.set_my_active_persona(uuid,text) to authenticated;
revoke all on function public.set_my_active_persona(uuid,text) from public,anon;
grant execute on function public.set_my_active_persona(uuid,text) to authenticated;
revoke all on function public.resolve_my_active_context() from public,anon;
grant execute on function public.resolve_my_active_context() to authenticated;
revoke all on function private.set_company_membership_status(uuid,text,text) from public,anon,authenticated;
grant execute on function private.set_company_membership_status(uuid,text,text) to authenticated;
revoke all on function public.set_company_membership_status(uuid,text,text) from public,anon;
grant execute on function public.set_company_membership_status(uuid,text,text) to authenticated;
revoke all on function private.close_safety_report_scoped(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.close_safety_report_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.close_safety_report_scoped(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.close_safety_report_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function private.issue_project_document_scoped(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.issue_project_document_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid) from public,anon;
grant execute on function public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid) to authenticated;
revoke all on function public.submit_procurement_request_scoped(uuid,uuid,uuid) from public,anon;
grant execute on function public.submit_procurement_request_scoped(uuid,uuid,uuid) to authenticated;
revoke all on function public.issue_procurement_order_scoped(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.issue_procurement_order_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid) from public,anon;
grant execute on function public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid) to authenticated;
revoke all on function public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text) from public,anon;
grant execute on function public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text) to authenticated;
revoke all on function public.cancel_project_document_scoped(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.cancel_project_document_scoped(uuid,uuid,uuid,text,uuid) to authenticated;
revoke all on function public.create_project_document_replacement_scoped(uuid,uuid,uuid,text,date,date,text,text,uuid) from public,anon;
grant execute on function public.create_project_document_replacement_scoped(uuid,uuid,uuid,text,date,date,text,text,uuid) to authenticated;
revoke insert,update,delete on public.documents from public,anon,authenticated;
revoke all on function public.list_my_final_signatory_documents() from public,anon;
grant execute on function public.list_my_final_signatory_documents() to authenticated;
revoke all on function public.issue_project_document_scoped(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.issue_project_document_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function private.link_project_personnel_identity(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.link_project_personnel_identity(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.link_project_personnel_identity(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.link_project_personnel_identity(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function private.list_project_workflow_approvers(uuid) from public,anon,authenticated;
grant execute on function private.list_project_workflow_approvers(uuid) to authenticated;
revoke all on function public.list_project_workflow_approvers(uuid) from public,anon;
grant execute on function public.list_project_workflow_approvers(uuid) to authenticated;
revoke all on function private.preview_rfin_redemption(text) from public,anon,authenticated;
grant execute on function private.preview_rfin_redemption(text) to authenticated;
revoke all on function public.preview_rfin_redemption(text) from public,anon;
grant execute on function public.preview_rfin_redemption(text) to authenticated;
revoke all on function public.reverse_inventory_transaction_scoped(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.reverse_inventory_transaction_scoped(uuid,uuid,uuid,text,uuid) to authenticated;
revoke all on function public.create_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text,boolean,text) from public,anon;
grant execute on function public.create_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text,boolean,text) to authenticated;
revoke all on function public.update_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text) from public,anon;
grant execute on function public.update_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text) to authenticated;
revoke all on function public.update_boq_billing_status_scoped(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.update_boq_billing_status_scoped(uuid,uuid,uuid,text,text) to authenticated;
revoke all on function private.add_business_days(timestamptz,integer,text,uuid) from public,anon,authenticated;
revoke all on function private.delegate_project_workflow_step(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function private.delegate_project_workflow_step(uuid,uuid,uuid,timestamptz,text) to authenticated;
revoke all on function public.delegate_project_workflow_step(uuid,uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.delegate_project_workflow_step(uuid,uuid,uuid,timestamptz,text) to authenticated;
revoke all on function private.reassign_project_workflow_step(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.reassign_project_workflow_step(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.reassign_project_workflow_step(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.reassign_project_workflow_step(uuid,uuid,uuid,text) to authenticated;
revoke all on function private.cancel_project_workflow(uuid,text,integer) from public,anon,authenticated;
grant execute on function private.cancel_project_workflow(uuid,text,integer) to authenticated;
revoke all on function public.cancel_project_workflow(uuid,text,integer) from public,anon;
grant execute on function public.cancel_project_workflow(uuid,text,integer) to authenticated;
revoke all on function private.run_workflow_sla_sweep() from public,anon,authenticated;
grant execute on function private.run_workflow_sla_sweep() to service_role;
revoke all on function public.import_project_backup_scoped(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.import_project_backup_scoped(uuid,uuid,jsonb,text) to authenticated;
revoke all on function public.reverse_cash_transaction_scoped(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.reverse_cash_transaction_scoped(uuid,uuid,uuid,text,uuid) to authenticated;
revoke all on function public.create_workflow_definition_scoped(uuid,uuid,text,text,text,text,text[],integer,text,text) from public,anon;
grant execute on function public.create_workflow_definition_scoped(uuid,uuid,text,text,text,text,text[],integer,text,text) to authenticated;
revoke all on function public.create_workflow_definition_steps_scoped(uuid,uuid,text,text,jsonb,integer,text,text) from public,anon;
grant execute on function public.create_workflow_definition_steps_scoped(uuid,uuid,text,text,jsonb,integer,text,text) to authenticated;
revoke all on function public.start_project_workflow_from_definition(uuid,uuid,uuid,text,uuid[],text,uuid) from public,anon;
grant execute on function public.start_project_workflow_from_definition(uuid,uuid,uuid,text,uuid[],text,uuid) to authenticated;
revoke all on function private.revoke_project_signatory_appointment(uuid,text) from public,anon,authenticated;
grant execute on function private.revoke_project_signatory_appointment(uuid,text) to authenticated;
revoke all on function public.revoke_project_signatory_appointment(uuid,text) from public,anon;
grant execute on function public.revoke_project_signatory_appointment(uuid,text) to authenticated;
revoke all on function public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid) from public,anon;
grant execute on function public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid) to authenticated;
revoke all on function public.submit_procurement_request_scoped(uuid,uuid,uuid) from public,anon;
grant execute on function public.submit_procurement_request_scoped(uuid,uuid,uuid) to authenticated;
revoke all on function public.issue_procurement_order_scoped(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.issue_procurement_order_scoped(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid) from public,anon;
grant execute on function public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid) to authenticated;
revoke all on public.persona_catalog,public.role_catalog,public.role_permission_catalog,public.authority_catalog from anon;
revoke all on public.company_membership_persona_assignments,public.company_membership_role_assignments,public.company_membership_authority_assignments from anon,authenticated;
grant select on public.persona_catalog,public.role_catalog,public.role_permission_catalog,public.authority_catalog to authenticated;
grant select on public.company_membership_persona_assignments,public.company_membership_role_assignments,public.company_membership_authority_assignments to authenticated;
revoke all on public.workflow_definitions,public.workflow_instances,public.workflow_steps,public.workflow_events,public.project_signatory_appointments from anon,authenticated;
grant select on public.workflow_definitions,public.workflow_instances,public.workflow_steps,public.workflow_events,public.project_signatory_appointments to authenticated;
revoke all on public.user_active_persona_contexts from anon,authenticated;
revoke all on public.procurement_vendors,public.procurement_requests,public.procurement_request_items,public.procurement_orders,public.procurement_order_items,public.goods_receipts,public.goods_receipt_items from anon,authenticated;
grant select on public.procurement_vendors,public.procurement_requests,public.procurement_request_items,public.procurement_orders,public.procurement_order_items,public.goods_receipts,public.goods_receipt_items to authenticated;
revoke all on public.user_notifications from anon,authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at) on public.user_notifications to authenticated;
revoke all on public.workflow_step_delegations from anon,authenticated;
grant select on public.workflow_step_delegations to authenticated;
revoke all on public.cash_transaction_reversals from anon,authenticated;
grant select on public.cash_transaction_reversals to authenticated;

drop policy if exists workspace_business_holidays_read_admin on public.workspace_business_holidays;
create policy workspace_business_holidays_read_admin on public.workspace_business_holidays for select to authenticated using(private.is_company_super_admin(workspace_id));

-- Final policy set and removal of superseded broad policies
drop policy if exists persona_catalog_active_read on public.persona_catalog;
drop policy if exists role_catalog_active_read on public.role_catalog;
drop policy if exists role_permission_catalog_active_read on public.role_permission_catalog;
drop policy if exists authority_catalog_active_read on public.authority_catalog;
drop policy if exists company_persona_assignment_read on public.company_membership_persona_assignments;
drop policy if exists company_role_assignment_read on public.company_membership_role_assignments;
drop policy if exists company_authority_assignment_read on public.company_membership_authority_assignments;
drop policy if exists workflow_definitions_project_read on public.workflow_definitions;
drop policy if exists workflow_instances_project_read on public.workflow_instances;
drop policy if exists workflow_steps_assignee_read on public.workflow_steps;
drop policy if exists workflow_events_project_read on public.workflow_events;
drop policy if exists signatory_appointment_project_read on public.project_signatory_appointments;
drop policy if exists boq_items_admin_delete on public.boq_items;
drop policy if exists boq_items_admin_update on public.boq_items;
drop policy if exists boq_items_read_legacy_role on public.boq_items;
drop policy if exists boq_sections_manage on public.boq_sections;
drop policy if exists boq_sections_read_legacy_role on public.boq_sections;
drop policy if exists boq_additions_read_legacy_role on public.boq_additions;
drop policy if exists boq_additions_update on public.boq_additions;
drop policy if exists cash_read_legacy_role on public.cash_transactions;
drop policy if exists inventory_read_legacy_role on public.inventory_transactions;
drop policy if exists inventory_reversals_read_legacy_role on public.inventory_transaction_reversals;
drop policy if exists documents_read_authenticated on public.documents;
drop policy if exists documents_insert_authorized on public.documents;
drop policy if exists documents_update_authorized on public.documents;
drop policy if exists documents_delete_authorized on public.documents;
drop policy if exists signatures_read_authenticated on public.document_signatures;
drop policy if exists signatures_insert_authorized on public.document_signatures;
drop policy if exists document_signatures_project_scope_insert_guard on public.document_signatures;
drop policy if exists progress_read_authenticated on public.progress_logs;
drop policy if exists progress_update_roles on public.progress_logs;
drop policy if exists progress_write_roles on public.progress_logs;
drop policy if exists personnel_read_authenticated on public.project_personnel;
drop policy if exists personnel_manage_admin on public.project_personnel;
drop policy if exists safety_read_authenticated on public.safety_reports;
drop policy if exists safety_insert_authenticated on public.safety_reports;
drop policy if exists safety_insert_admin_restore on public.safety_reports;
drop policy if exists safety_update_roles on public.safety_reports;
drop policy if exists inventory_locations_read on public.inventory_locations;
drop policy if exists inventory_locations_update on public.inventory_locations;
drop policy if exists inventory_locations_delete on public.inventory_locations;
drop policy if exists item_schedules_read on public.item_schedules;
drop policy if exists item_schedules_update on public.item_schedules;
drop policy if exists item_schedules_delete on public.item_schedules;
drop policy if exists project_control_read on public.project_control;
drop policy if exists project_control_update on public.project_control;
drop policy if exists media_read_authenticated on public.project_media;
drop policy if exists media_delete_admin on public.project_media;
drop policy if exists transaction_attachments_read_auth on public.transaction_attachments;
drop policy if exists audit_read_admin_auditor on public.audit_logs;
drop policy if exists project_evidence_insert_auth on storage.objects;
drop policy if exists project_evidence_read_auth on storage.objects;
drop policy if exists project_evidence_delete_admin on storage.objects;
drop policy if exists inventory_locations_project_read on public.inventory_locations;
drop policy if exists inventory_locations_project_manage on public.inventory_locations;
drop policy if exists item_schedules_project_read on public.item_schedules;
drop policy if exists item_schedules_project_update on public.item_schedules;
drop policy if exists project_control_project_read on public.project_control;
drop policy if exists project_control_project_update on public.project_control;
drop policy if exists project_media_project_read on public.project_media;
drop policy if exists transaction_attachments_project_read on public.transaction_attachments;
drop policy if exists audit_read_project_or_company_admin on public.audit_logs;
drop policy if exists procurement_vendor_read on public.procurement_vendors;
drop policy if exists procurement_requests_project_read on public.procurement_requests;
drop policy if exists procurement_request_items_project_read on public.procurement_request_items;
drop policy if exists procurement_orders_project_read on public.procurement_orders;
drop policy if exists procurement_order_items_project_read on public.procurement_order_items;
drop policy if exists goods_receipts_project_read on public.goods_receipts;
drop policy if exists goods_receipt_items_project_read on public.goods_receipt_items;
drop policy if exists user_notifications_read_own on public.user_notifications;
drop policy if exists user_notifications_update_own on public.user_notifications;
drop policy if exists workflow_delegations_project_read on public.workflow_step_delegations;
drop policy if exists cash_reversal_project_read on public.cash_transaction_reversals;
drop policy if exists item_schedules_project_insert on public.item_schedules;
create policy procurement_vendor_read on public.procurement_vendors for select to authenticated using(exists(select 1 from public.company_memberships cm where cm.workspace_id=procurement_vendors.workspace_id and cm.user_id=(select auth.uid()) and cm.membership_status='ACTIVE'));
create policy procurement_requests_project_read on public.procurement_requests for select to authenticated using(private.project_scope_guard(project_id,'procurement.read'));
create policy procurement_request_items_project_read on public.procurement_request_items for select to authenticated using(private.project_scope_guard(project_id,'procurement.read'));
create policy procurement_orders_project_read on public.procurement_orders for select to authenticated using(private.project_scope_guard(project_id,'procurement.read'));
create policy procurement_order_items_project_read on public.procurement_order_items for select to authenticated using(private.project_scope_guard(project_id,'procurement.read'));
create policy goods_receipts_project_read on public.goods_receipts for select to authenticated using(private.project_scope_guard(project_id,'procurement.read'));
create policy goods_receipt_items_project_read on public.goods_receipt_items for select to authenticated using(exists(select 1 from public.goods_receipts gr where gr.id=receipt_id and private.project_scope_guard(gr.project_id,'procurement.read')));
create policy user_notifications_read_own on public.user_notifications for select to authenticated using(user_id=(select auth.uid()));
create policy user_notifications_update_own on public.user_notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy workflow_delegations_project_read on public.workflow_step_delegations for select to authenticated
using(private.can_read_workflow(workflow_id) or delegate_user_id=(select auth.uid()) or delegator_user_id=(select auth.uid()));
create policy cash_reversal_project_read on public.cash_transaction_reversals for select to authenticated using(private.project_scope_guard(project_id,'cash.read'));
create policy item_schedules_project_insert on public.item_schedules for insert to authenticated
with check(private.project_scope_guard(project_id,'project.update'));
-- Final signatures are written only by the atomic SECURITY DEFINER issuance RPC.
-- Direct client INSERT is revoked below so approval and signing cannot be conflated.
create policy inventory_locations_project_read on public.inventory_locations for select to authenticated
using(private.project_scope_guard(project_id,'inventory.read'));
create policy inventory_locations_project_manage on public.inventory_locations for all to authenticated
using(private.project_scope_guard(project_id,'inventory.location.manage'))
with check(private.project_scope_guard(project_id,'inventory.location.manage'));
create policy item_schedules_project_read on public.item_schedules for select to authenticated
using(private.project_scope_guard(project_id,'progress.read'));
create policy item_schedules_project_update on public.item_schedules for update to authenticated
using(private.project_scope_guard(project_id,'progress.update'))
with check(private.project_scope_guard(project_id,'progress.update'));
create policy project_control_project_read on public.project_control for select to authenticated
using(private.project_scope_guard(project_id,'project.read'));
create policy project_control_project_update on public.project_control for update to authenticated
using(private.project_scope_guard(project_id,'project.update'))
with check(private.project_scope_guard(project_id,'project.update'));
create policy project_media_project_read on public.project_media for select to authenticated
using(private.project_scope_guard(project_id,'project.read'));
create policy transaction_attachments_project_read on public.transaction_attachments for select to authenticated
using(private.attachment_project_scope_guard(project_id,transaction_kind,'read'));
create policy audit_read_project_or_company_admin on public.audit_logs for select to authenticated
using ((project_id is not null and private.project_scope_guard(project_id,'audit.read'))
 or (workspace_id is not null and private.is_company_super_admin(workspace_id))
 or exists(select 1 from public.platform_admins pa where pa.user_id=(select auth.uid())));

create or replace function private.set_workspace_business_holiday(p_workspace_id uuid,p_holiday_date date,p_label text,p_is_holiday boolean,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required'; end if;
 if p_holiday_date is null or length(trim(coalesce(p_reason,'')))<8 or length(trim(coalesce(p_reason,'')))>500 then raise exception 'Holiday date and audit reason are required'; end if;
 if p_is_holiday then
  if length(trim(coalesce(p_label,'')))<2 or length(trim(p_label))>160 then raise exception 'Holiday label must contain 2-160 characters'; end if;
  insert into public.workspace_business_holidays(workspace_id,holiday_date,label,created_by)
  values(p_workspace_id,p_holiday_date,trim(p_label),(select auth.uid()))
  on conflict(workspace_id,holiday_date) do update set label=excluded.label,updated_at=now();
 else
  delete from public.workspace_business_holidays where workspace_id=p_workspace_id and holiday_date=p_holiday_date;
 end if;
 insert into public.audit_logs(actor_id,workspace_id,action,entity_type,entity_id,details)
 values((select auth.uid()),p_workspace_id,case when p_is_holiday then 'workspace.business_holiday.set' else 'workspace.business_holiday.removed' end,
  'workspace_business_holiday',p_holiday_date::text,jsonb_build_object('label',nullif(trim(coalesce(p_label,'')),''),'reason',trim(p_reason)));
end $$;
create or replace function public.set_workspace_business_holiday(p_workspace_id uuid,p_holiday_date date,p_label text,p_is_holiday boolean,p_reason text)
returns void language sql security invoker set search_path=''
as $$ select private.set_workspace_business_holiday(p_workspace_id,p_holiday_date,p_label,p_is_holiday,p_reason); $$;
revoke all on function private.set_workspace_business_holiday(uuid,date,text,boolean,text) from public,anon,authenticated;
grant execute on function private.set_workspace_business_holiday(uuid,date,text,boolean,text) to authenticated;
revoke all on function public.set_workspace_business_holiday(uuid,date,text,boolean,text) from public,anon;
grant execute on function public.set_workspace_business_holiday(uuid,date,text,boolean,text) to authenticated;

create or replace function public.list_company_audit_events(p_workspace_id uuid,p_limit integer default 50,p_before timestamptz default null)
returns table(id bigint,actor_id uuid,action text,entity_type text,entity_id text,project_id uuid,details jsonb,created_at timestamptz)
language plpgsql security definer set search_path=''
as $wfbody11$
begin
 if not private.is_company_super_admin(p_workspace_id) then raise exception 'Company Super Admin required for tenant audit trail'; end if;
 return query
  select l.id,l.actor_id,l.action,l.entity_type,l.entity_id,l.project_id,
   coalesce(l.details,'{}'::jsonb)-array['token','code','secret','password','npwp','phone']::text[],l.created_at
  from public.audit_logs l
  where l.workspace_id=p_workspace_id and (p_before is null or l.created_at<p_before)
  order by l.created_at desc,l.id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $wfbody11$;
revoke all on function public.list_company_audit_events(uuid,integer,timestamptz) from public,anon;
grant execute on function public.list_company_audit_events(uuid,integer,timestamptz) to authenticated;

-- Workflow resource lifecycle trigger
create trigger workflow_resource_transition after update of status on public.workflow_instances
for each row execute function private.apply_workflow_resource_transition();


-- Enable the supported Supabase scheduler and run SLA reminders/escalations
-- hourly during the default Asia/Jakarta business window (08:00–17:00, Mon–Fri).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('udu-workflow-sla-sweep','0 1-10 * * 1-5','select private.run_workflow_sla_sweep();');

commit;

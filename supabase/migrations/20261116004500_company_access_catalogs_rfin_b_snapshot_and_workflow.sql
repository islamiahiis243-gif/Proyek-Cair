begin;

-- 1. Platform-owned catalogs. Role presets intentionally have no implicit permission bundle:
-- SSOT §16.10 leaves exact default combinations for technical specification.
create table if not exists public.persona_catalog (
  persona_code text primary key,
  display_name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
create table if not exists public.role_catalog (
  role_code text primary key,
  display_name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
create table if not exists public.role_permission_catalog (
  role_code text not null references public.role_catalog(role_code),
  permission_code text not null references public.project_permission_catalog(permission_code),
  active boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  primary key(role_code,permission_code)
);
create table if not exists public.authority_catalog (
  authority_code text primary key,
  permission_code text not null unique references public.project_permission_catalog(permission_code),
  display_name text not null,
  description text not null default '',
  allowed_dimensions text[] not null default array['project','transaction_category','document_type','workflow_stage','amount'],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.persona_catalog(persona_code,display_name,description,sort_order) values
 ('PROJECT_MANAGER','Project Manager','Konteks pengelolaan dan koordinasi proyek',10),
 ('CONSTRUCTION_MANAGER','Construction Manager','Konteks pengelolaan pelaksanaan konstruksi',20),
 ('SITE_ENGINEER','Site Engineer','Konteks teknis dan pelaporan lapangan',30),
 ('DATA_INPUTTER','Data Inputter','Konteks input dan pemutakhiran data operasional',40),
 ('PROCUREMENT','Procurement','Konteks pengadaan dan penerimaan barang/jasa',50),
 ('FINANCE','Finance','Konteks administrasi keuangan proyek',60),
 ('STOREKEEPER','Storekeeper','Konteks pengelolaan persediaan dan gudang',70),
 ('HSE_OFFICER','HSE Officer','Konteks keselamatan dan kesehatan kerja',80),
 ('DOCUMENT_CONTROLLER','Document Controller','Konteks pengendalian dokumen dan versi',90),
 ('VIEWER','Viewer','Konteks baca sesuai izin eksplisit',100)
on conflict(persona_code) do update set display_name=excluded.display_name,description=excluded.description,sort_order=excluded.sort_order,active=true;

insert into public.role_catalog(role_code,display_name,description,sort_order) values
 ('PROJECT_MANAGER','Project Manager','Preset tanggung jawab pengelolaan proyek',10),
 ('SITE_ENGINEER','Site Engineer','Preset tanggung jawab teknis lapangan',20),
 ('PROCUREMENT','Procurement','Preset tanggung jawab pengadaan',30),
 ('FINANCE','Finance','Preset tanggung jawab keuangan',40),
 ('STOREKEEPER','Storekeeper','Preset tanggung jawab gudang',50),
 ('HSE_OFFICER','HSE Officer','Preset tanggung jawab K3/HSE',60),
 ('DOCUMENT_CONTROLLER','Document Controller','Preset tanggung jawab dokumen',70),
 ('VIEWER','Viewer','Preset tanggung jawab baca terbatas',80)
on conflict(role_code) do update set display_name=excluded.display_name,description=excluded.description,sort_order=excluded.sort_order,active=true;

insert into public.authority_catalog(authority_code,permission_code,display_name,description)
select permission_code,permission_code,permission_code,description
from public.project_permission_catalog
where active and requires_authority_check
on conflict(authority_code) do update set permission_code=excluded.permission_code,display_name=excluded.display_name,description=excluded.description,active=true;

-- 2. Tenant-bound individual assignments. No direct authenticated writes.
create table if not exists public.company_membership_persona_assignments (
 id uuid primary key default gen_random_uuid(),
 company_membership_id uuid not null references public.company_memberships(id),
 workspace_id uuid not null references public.workspaces(id),
 persona_code text not null references public.persona_catalog(persona_code),
 assigned_by uuid not null references auth.users(id),
 reason text not null,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check(ends_at is null or ends_at>starts_at)
);
create unique index if not exists company_membership_persona_active_uq
 on public.company_membership_persona_assignments(company_membership_id,persona_code)
 where revoked_at is null and ends_at is null;

create table if not exists public.company_membership_role_assignments (
 id uuid primary key default gen_random_uuid(),
 company_membership_id uuid not null references public.company_memberships(id),
 workspace_id uuid not null references public.workspaces(id),
 role_code text not null references public.role_catalog(role_code),
 assigned_by uuid not null references auth.users(id),
 reason text not null,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check(ends_at is null or ends_at>starts_at)
);
create unique index if not exists company_membership_role_active_uq
 on public.company_membership_role_assignments(company_membership_id,role_code)
 where revoked_at is null and ends_at is null;

create table if not exists public.company_membership_authority_assignments (
 id uuid primary key default gen_random_uuid(),
 company_membership_id uuid not null references public.company_memberships(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),
 authority_code text not null references public.authority_catalog(authority_code),
 scope jsonb not null default '{}'::jsonb,
 max_amount numeric(20,2),
 currency text,
 assigned_by uuid not null references auth.users(id),
 reason text not null,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check((max_amount is null and currency is null) or (max_amount>=0 and currency ~ '^[A-Z]{3}$')),
 check(ends_at is null or ends_at>starts_at),
 check(jsonb_typeof(scope)='object')
);
create index if not exists company_membership_authority_lookup_idx
 on public.company_membership_authority_assignments(company_membership_id,project_id,authority_code)
 where revoked_at is null;

alter table public.persona_catalog enable row level security;
alter table public.role_catalog enable row level security;
alter table public.role_permission_catalog enable row level security;
alter table public.authority_catalog enable row level security;
alter table public.company_membership_persona_assignments enable row level security;
alter table public.company_membership_role_assignments enable row level security;
alter table public.company_membership_authority_assignments enable row level security;

drop policy if exists persona_catalog_active_read on public.persona_catalog;
create policy persona_catalog_active_read on public.persona_catalog for select to authenticated using(active);
drop policy if exists role_catalog_active_read on public.role_catalog;
create policy role_catalog_active_read on public.role_catalog for select to authenticated using(active);
drop policy if exists role_permission_catalog_active_read on public.role_permission_catalog;
create policy role_permission_catalog_active_read on public.role_permission_catalog for select to authenticated using(active);
drop policy if exists authority_catalog_active_read on public.authority_catalog;
create policy authority_catalog_active_read on public.authority_catalog for select to authenticated using(active);

drop policy if exists company_persona_assignment_read on public.company_membership_persona_assignments;
create policy company_persona_assignment_read on public.company_membership_persona_assignments for select to authenticated
using (private.is_company_super_admin(workspace_id) or exists(select 1 from public.company_memberships m where m.id=company_membership_id and m.user_id=(select auth.uid())));
drop policy if exists company_role_assignment_read on public.company_membership_role_assignments;
create policy company_role_assignment_read on public.company_membership_role_assignments for select to authenticated
using (private.is_company_super_admin(workspace_id) or exists(select 1 from public.company_memberships m where m.id=company_membership_id and m.user_id=(select auth.uid())));
drop policy if exists company_authority_assignment_read on public.company_membership_authority_assignments;
create policy company_authority_assignment_read on public.company_membership_authority_assignments for select to authenticated
using (private.is_company_super_admin(workspace_id) or exists(select 1 from public.company_memberships m where m.id=company_membership_id and m.user_id=(select auth.uid())));

revoke all on public.persona_catalog,public.role_catalog,public.role_permission_catalog,public.authority_catalog from anon;
revoke all on public.company_membership_persona_assignments,public.company_membership_role_assignments,public.company_membership_authority_assignments from anon,authenticated;
grant select on public.persona_catalog,public.role_catalog,public.role_permission_catalog,public.authority_catalog to authenticated;
grant select on public.company_membership_persona_assignments,public.company_membership_role_assignments,public.company_membership_authority_assignments to authenticated;

-- 3. Authority check helper. All dimensions are explicit and deny by default.
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
    and (p_amount is null or (aa.max_amount is not null and aa.max_amount>=p_amount and aa.currency=p_currency))
    and (p_scope is null or p_scope='{}'::jsonb or aa.scope @> p_scope)
 );
$$;
revoke all on function private.has_project_authority(uuid,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function private.has_project_authority(uuid,text,numeric,text,jsonb) to authenticated;

-- 4. Company Console read APIs; no direct access to Auth identities or token hashes.
create or replace function private.list_company_members_for_console(p_workspace_id uuid)
returns table(membership_id uuid,user_id uuid,email text,full_name text,membership_status text,activated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.is_company_super_admin(p_workspace_id) then raise exception 'Active Company Super Admin required'; end if;
 return query
 select m.id,m.user_id,u.email,coalesce(p.full_name,''),m.membership_status,m.activated_at
 from public.company_memberships m
 join auth.users u on u.id=m.user_id
 left join public.profiles p on p.id=m.user_id
 where m.workspace_id=p_workspace_id and m.is_company_super_admin=false
 order by lower(coalesce(p.full_name,u.email)),u.email;
end $$;
revoke all on function private.list_company_members_for_console(uuid) from public,anon,authenticated;
grant execute on function private.list_company_members_for_console(uuid) to authenticated;
create or replace function public.list_company_members_for_console(p_workspace_id uuid)
returns table(membership_id uuid,user_id uuid,email text,full_name text,membership_status text,activated_at timestamptz)
language sql stable security invoker set search_path=''
as $$ select * from private.list_company_members_for_console(p_workspace_id); $$;
revoke all on function public.list_company_members_for_console(uuid) from public,anon;
grant execute on function public.list_company_members_for_console(uuid) to authenticated;

create or replace function private.list_company_rfin_b(p_company_id uuid)
returns table(token_id uuid,recipient_email text,created_at timestamptz,expires_at timestamptz,redeemed_at timestamptz,revoked_at timestamptz,snapshot jsonb)
language plpgsql stable security definer set search_path=''
as $$
declare v_workspace uuid;
begin
 select w.id into v_workspace from public.workspaces w where w.company_id=p_company_id and w.workspace_type='COMPANY';
 if v_workspace is null or not private.is_company_super_admin(v_workspace) then raise exception 'Active Company Super Admin required'; end if;
 return query select t.id,t.recipient_email,t.created_at,t.expires_at,t.redeemed_at,t.revoked_at,
   jsonb_build_object('display_name',t.metadata->'snapshot'->'display_name','persona_codes',t.metadata->'snapshot'->'persona_codes',
   'role_codes',t.metadata->'snapshot'->'role_codes','project_assignments',t.metadata->'snapshot'->'project_assignments',
   'authority_scopes',t.metadata->'snapshot'->'authority_scopes','schema_version',t.metadata->'snapshot'->'schema_version')
 from public.rfin_tokens t where t.company_id=p_company_id and t.token_class='RFIN_B'
 order by t.created_at desc;
end $$;
revoke all on function private.list_company_rfin_b(uuid) from public,anon,authenticated;
grant execute on function private.list_company_rfin_b(uuid) to authenticated;
create or replace function public.list_company_rfin_b(p_company_id uuid)
returns table(token_id uuid,recipient_email text,created_at timestamptz,expires_at timestamptz,redeemed_at timestamptz,revoked_at timestamptz,snapshot jsonb)
language sql stable security invoker set search_path=''
as $$ select * from private.list_company_rfin_b(p_company_id); $$;
revoke all on function public.list_company_rfin_b(uuid) from public,anon;
grant execute on function public.list_company_rfin_b(uuid) to authenticated;

-- 5. RFIN-B issuance with an immutable, validated access snapshot.
create or replace function private.issue_rfin_b_with_snapshot(
 p_company_id uuid,p_recipient_email text,p_snapshot jsonb,p_expires_in interval default interval '7 days',p_reason text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_workspace uuid; v_code text; v_token_id uuid; v_email text; v_project jsonb; v_auth jsonb; v_permission text;
begin
 select w.id into v_workspace from public.workspaces w
 where w.company_id=p_company_id and w.workspace_type='COMPANY' and w.status='ACTIVE';
 if v_workspace is null or not private.is_company_super_admin(v_workspace) then raise exception 'Active Company Super Admin required'; end if;
 v_email:=lower(trim(coalesce(p_recipient_email,'')));
 if v_email !~ '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'Recipient email is invalid'; end if;
 if p_expires_in<=interval '0' or p_expires_in>interval '14 days' then raise exception 'Expiry must be 1-14 days'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if jsonb_typeof(p_snapshot)<>'object' or p_snapshot->>'schema_version'<>'1' then raise exception 'RFIN-B snapshot schema version 1 required'; end if;
 if jsonb_typeof(p_snapshot->'persona_codes')<>'array' or jsonb_array_length(p_snapshot->'persona_codes')<1 then raise exception 'At least one Persona is required'; end if;
 if jsonb_typeof(p_snapshot->'role_codes')<>'array' or jsonb_array_length(p_snapshot->'role_codes')<1 then raise exception 'At least one Role preset is required'; end if;
 if jsonb_typeof(p_snapshot->'project_assignments')<>'array' or jsonb_array_length(p_snapshot->'project_assignments')<1 then raise exception 'At least one Project and explicit permission scope is required'; end if;
 if jsonb_typeof(coalesce(p_snapshot->'authority_scopes','[]'::jsonb))<>'array' then raise exception 'Authority scope must be an array'; end if;
 if jsonb_array_length(p_snapshot->'persona_codes')>10 or jsonb_array_length(p_snapshot->'role_codes')>8 or jsonb_array_length(p_snapshot->'project_assignments')>50 or jsonb_array_length(coalesce(p_snapshot->'authority_scopes','[]'::jsonb))>100 then raise exception 'RFIN-B snapshot selection limit exceeded'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'persona_codes') x(code) group by code having count(*)>1)
 or exists(select 1 from jsonb_array_elements_text(p_snapshot->'role_codes') x(code) group by code having count(*)>1) then raise exception 'Duplicate Persona or Role selection'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'persona_codes') x(code) where not exists(select 1 from public.persona_catalog pc where pc.persona_code=x.code and pc.active)) then raise exception 'Unknown or inactive Persona'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_snapshot->'role_codes') x(code) where not exists(select 1 from public.role_catalog rc where rc.role_code=x.code and rc.active)) then raise exception 'Unknown or inactive Role'; end if;
 for v_project in select value from jsonb_array_elements(p_snapshot->'project_assignments') loop
  if nullif(v_project->>'project_id','') is null or jsonb_typeof(v_project->'permission_codes')<>'array' or jsonb_array_length(v_project->'permission_codes')<1 then raise exception 'Every Project needs explicit permission selection'; end if;
  if not exists(select 1 from public.projects pr where pr.id=(v_project->>'project_id')::uuid and pr.workspace_id=v_workspace and pr.status='ACTIVE') then raise exception 'Project is not active in the target Company Workspace'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_project->'permission_codes') pc(code) where not exists(select 1 from public.project_permission_catalog c where c.permission_code=pc.code and c.active)) then raise exception 'Unknown or inactive Project permission'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_project->'permission_codes') pc(code)
    join public.project_permission_catalog c on c.permission_code=pc.code
    where c.requires_authority_check and not exists(
      select 1 from jsonb_array_elements(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) a
      where a->>'project_id'=v_project->>'project_id' and a->>'authority_code'=pc.code
    )) then raise exception 'Authority-gated permission requires an explicit authority scope for the same Project'; end if;
 end loop;
 for v_auth in select value from jsonb_array_elements(coalesce(p_snapshot->'authority_scopes','[]'::jsonb)) loop
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
   'snapshot',p_snapshot,'token_hash_persisted',true));
 return jsonb_build_object('token_id',v_token_id,'code',v_code,'expires_at',now()+p_expires_in,'snapshot',p_snapshot);
end $$;
revoke all on function private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) from public,anon,authenticated;
grant execute on function private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) to authenticated;
create or replace function public.issue_rfin_b_with_snapshot(
 p_company_id uuid,p_recipient_email text,p_snapshot jsonb,p_expires_in interval default interval '7 days',p_reason text default null
) returns jsonb language sql security invoker set search_path=''
as $$ select private.issue_rfin_b_with_snapshot(p_company_id,p_recipient_email,p_snapshot,p_expires_in,p_reason); $$;
revoke all on function public.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) from public,anon;
grant execute on function public.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text) to authenticated;

-- Old email-only issuance is deliberately disabled: an invitation without an approved access snapshot is invalid.
create or replace function public.issue_rfin_b(p_company_id uuid,p_recipient_email text,p_expires_in interval default interval '7 days')
returns text language plpgsql security invoker set search_path=''
as $$ begin raise exception 'RFIN-B requires a complete access snapshot. Use issue_rfin_b_with_snapshot.'; end $$;
revoke all on function public.issue_rfin_b(uuid,text,interval) from public,anon;
grant execute on function public.issue_rfin_b(uuid,text,interval) to authenticated;

-- 6. Atomic redemption: Company Membership and all snapshot assignments commit together.
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
  on conflict(company_id,user_id) do update set membership_status='ACTIVE',activated_at=now(),invited_by=excluded.invited_by,updated_at=now()
  returning id into v_membership;

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
revoke all on function private.redeem_rfin(text) from public,anon,authenticated;
grant execute on function private.redeem_rfin(text) to authenticated;
create or replace function public.redeem_rfin(p_code text)
returns jsonb language sql security invoker set search_path=''
as $$ select private.redeem_rfin(p_code); $$;
revoke all on function public.redeem_rfin(text) from public,anon;
grant execute on function public.redeem_rfin(text) to authenticated;

-- 7. Explicit member assignment API for Company Console.
create or replace function private.replace_company_member_access(
 p_membership_id uuid,p_persona_codes text[],p_role_codes text[],p_project_assignments jsonb,p_authority_scopes jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_member public.company_memberships; v_project jsonb; v_auth jsonb; v_pm uuid; v_code text; v_workspace uuid;
begin
 select * into v_member from public.company_memberships where id=p_membership_id for update;
 if not found or v_member.is_company_super_admin or not private.is_company_super_admin(v_member.workspace_id) then raise exception 'Active Company Super Admin and non-admin member required'; end if;
 v_workspace:=v_member.workspace_id;
 if v_member.membership_status not in ('ACTIVE','PENDING','SUSPENDED') then raise exception 'Membership lifecycle does not permit access assignment'; end if;
 if length(trim(coalesce(p_reason,'')))<8 or length(trim(p_reason))>500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if coalesce(array_length(p_persona_codes,1),0)<1 or coalesce(array_length(p_role_codes,1),0)<1 or jsonb_typeof(p_project_assignments)<>'array' then raise exception 'Persona, Role and Project assignments are required'; end if;
 if exists(select 1 from unnest(p_persona_codes) x where not exists(select 1 from public.persona_catalog c where c.persona_code=x and c.active))
 or exists(select 1 from unnest(p_role_codes) x where not exists(select 1 from public.role_catalog c where c.role_code=x and c.active)) then raise exception 'Unknown or inactive Persona/Role'; end if;
 -- Revoke current active assignments without deleting their history.
 update public.company_membership_persona_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 update public.company_membership_role_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 update public.company_membership_authority_assignments set revoked_at=now(),ends_at=coalesce(ends_at,now()) where company_membership_id=p_membership_id and revoked_at is null;
 insert into public.company_membership_persona_assignments(company_membership_id,workspace_id,persona_code,assigned_by,reason)
 select p_membership_id,v_workspace,x,(select auth.uid()),trim(p_reason) from unnest(p_persona_codes) x;
 insert into public.company_membership_role_assignments(company_membership_id,workspace_id,role_code,assigned_by,reason)
 select p_membership_id,v_workspace,x,(select auth.uid()),trim(p_reason) from unnest(p_role_codes) x;
 -- Remove permissions only for projects in this assignment payload, then replace them.
 for v_project in select value from jsonb_array_elements(p_project_assignments) loop
  if not exists(select 1 from public.projects p where p.id=(v_project->>'project_id')::uuid and p.workspace_id=v_workspace and p.status='ACTIVE') then raise exception 'Project outside Company Workspace or inactive'; end if;
  if jsonb_typeof(v_project->'permission_codes')<>'array' then raise exception 'Project permission list is required'; end if;
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
 for v_auth in select value from jsonb_array_elements(coalesce(p_authority_scopes,'[]'::jsonb)) loop
  if not exists(select 1 from public.authority_catalog a where a.authority_code=v_auth->>'authority_code' and a.active)
     or not exists(select 1 from jsonb_array_elements(p_project_assignments) p where p->>'project_id'=v_auth->>'project_id') then raise exception 'Authority catalog or Project binding invalid'; end if;
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
revoke all on function private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) to authenticated;
create or replace function public.replace_company_member_access(
 p_membership_id uuid,p_persona_codes text[],p_role_codes text[],p_project_assignments jsonb,p_authority_scopes jsonb,p_reason text
) returns jsonb language sql security invoker set search_path=''
as $$ select private.replace_company_member_access(p_membership_id,p_persona_codes,p_role_codes,p_project_assignments,p_authority_scopes,p_reason); $$;
revoke all on function public.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) from public,anon;
grant execute on function public.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text) to authenticated;

-- 8. Workflow Engine: serial approval, immutable events, idempotency and concurrency.
create table if not exists public.workflow_definitions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),
 process_type text not null,
 display_name text not null,
 version integer not null default 1,
 step_templates jsonb not null,
 sla_business_days integer not null default 2 check(sla_business_days between 1 and 90),
 timezone text not null default 'Asia/Jakarta',
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(project_id,process_type,version),
 check(jsonb_typeof(step_templates)='array' and jsonb_array_length(step_templates)>0)
);
create table if not exists public.workflow_instances (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),
 definition_id uuid references public.workflow_definitions(id),
 process_type text not null,
 resource_type text not null,
 resource_id uuid not null,
 resource_version text,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','COMPLETED','RETURNED','REJECTED','CANCELLED','EXPIRED')),
 initiated_by uuid not null references auth.users(id),
 active_step_order integer not null default 1,
 expected_version integer not null default 1,
 idempotency_key uuid not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(project_id,idempotency_key)
);
create table if not exists public.workflow_steps (
 id uuid primary key default gen_random_uuid(),
 workflow_id uuid not null references public.workflow_instances(id),
 step_order integer not null,
 assignee_user_id uuid not null references auth.users(id),
 permission_code text not null references public.project_permission_catalog(permission_code),
 authority_code text,
 status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','APPROVED','REJECTED','RETURNED','SKIPPED')),
 due_at timestamptz,
 acted_at timestamptz,
 action text check(action in ('APPROVE','REJECT','RETURN')),
 reason text,
 created_at timestamptz not null default now(),
 unique(workflow_id,step_order)
);
create unique index if not exists workflow_one_active_step_uq on public.workflow_steps(workflow_id) where status='ACTIVE';
create index if not exists workflow_steps_assignee_idx on public.workflow_steps(assignee_user_id,status,due_at);
create table if not exists public.workflow_events (
 id uuid primary key default gen_random_uuid(),
 workflow_id uuid not null references public.workflow_instances(id),
 step_id uuid references public.workflow_steps(id),
 actor_id uuid references auth.users(id),
 event_type text not null,
 from_status text,
 to_status text,
 reason text,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.project_signatory_appointments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),
 company_membership_id uuid not null references public.company_memberships(id),
 user_id uuid not null references auth.users(id),
 document_type text not null,
 scope jsonb not null default '{}'::jsonb,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED','EXPIRED')),
 appointed_by uuid not null references auth.users(id),
 reason text not null,
 created_at timestamptz not null default now(),
 check(ends_at is null or ends_at>starts_at)
);
create index if not exists project_signatory_lookup_idx on public.project_signatory_appointments(project_id,user_id,document_type,status);

alter table public.workflow_definitions enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_events enable row level security;
alter table public.project_signatory_appointments enable row level security;
drop policy if exists workflow_definitions_project_read on public.workflow_definitions;
create policy workflow_definitions_project_read on public.workflow_definitions for select to authenticated using(private.has_project_permission(project_id,'workflow.read'));
drop policy if exists workflow_instances_project_read on public.workflow_instances;
create policy workflow_instances_project_read on public.workflow_instances for select to authenticated using(private.has_project_permission(project_id,'workflow.read'));
drop policy if exists workflow_steps_assignee_read on public.workflow_steps;
create policy workflow_steps_assignee_read on public.workflow_steps for select to authenticated using(assignee_user_id=(select auth.uid()) or exists(select 1 from public.workflow_instances w where w.id=workflow_id and private.has_project_permission(w.project_id,'workflow.read')));
drop policy if exists workflow_events_project_read on public.workflow_events;
create policy workflow_events_project_read on public.workflow_events for select to authenticated using(exists(select 1 from public.workflow_instances w where w.id=workflow_id and private.has_project_permission(w.project_id,'workflow.read')));
drop policy if exists signatory_appointment_project_read on public.project_signatory_appointments;
create policy signatory_appointment_project_read on public.project_signatory_appointments for select to authenticated using(private.has_project_permission(project_id,'document.read') or private.is_company_super_admin(workspace_id));
revoke all on public.workflow_definitions,public.workflow_instances,public.workflow_steps,public.workflow_events,public.project_signatory_appointments from anon,authenticated;
grant select on public.workflow_definitions,public.workflow_instances,public.workflow_steps,public.workflow_events,public.project_signatory_appointments to authenticated;

create or replace function private.start_project_workflow(
 p_project_id uuid,p_process_type text,p_resource_type text,p_resource_id uuid,p_resource_version text,
 p_approver_ids uuid[],p_permission_code text,p_authority_code text,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_project public.projects; v_company uuid; v_workspace uuid; v_id uuid; v_step integer:=1; v_user uuid; v_due timestamptz;
begin
 select p.* into v_project from public.projects p where p.id=p_project_id and p.status='ACTIVE';
 if not found or not private.has_project_permission(p_project_id,'workflow.start') then raise exception 'Workflow start permission required'; end if;
 if p_resource_type not in ('BOQ','PROGRESS','PROCUREMENT','INVENTORY','CASH','K3','DOCUMENT') or p_resource_id is null then raise exception 'Unsupported workflow resource'; end if;
 if coalesce(array_length(p_approver_ids,1),0)<1 or array_length(p_approver_ids,1)>20 then raise exception 'Approver chain must contain 1-20 users'; end if;
 if p_permission_code not in ('boq.approve','progress.approve','progress.review','procurement.approve','inventory.movement.approve','cash.transaction.approve','k3.report.review','document.approve','document.issue') then raise exception 'Invalid workflow action permission'; end if;
 if exists(select 1 from unnest(p_approver_ids) with ordinality a(user_id,ord) group by user_id having count(*)>1) then raise exception 'Duplicate approver in serial chain'; end if;
 if exists(select 1 from unnest(p_approver_ids) u where not exists(
   select 1 from public.project_memberships pm join public.project_membership_permissions pp on pp.project_membership_id=pm.id
   where pm.project_id=p_project_id and pm.user_id=u and pm.membership_status='ACTIVE' and pp.permission_code=p_permission_code
 )) then raise exception 'Every approver must be an active Project Member with the required permission'; end if;
 if (select auth.uid())=any(p_approver_ids) and p_process_type in ('CASH','DOCUMENT') then raise exception 'Self approval is prohibited for cash and formal documents'; end if;
 select w.company_id,w.id into v_company,v_workspace from public.workspaces w where w.id=v_project.workspace_id;
 insert into public.workflow_instances(company_id,workspace_id,project_id,process_type,resource_type,resource_id,resource_version,initiated_by,idempotency_key,snapshot)
 values(v_company,v_workspace,p_project_id,p_process_type,p_resource_type,p_resource_id,p_resource_version,(select auth.uid()),p_idempotency_key,
 jsonb_build_object('approvers',p_approver_ids,'permission_code',p_permission_code,'authority_code',p_authority_code))
 on conflict(project_id,idempotency_key) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.workflow_instances where project_id=p_project_id and idempotency_key=p_idempotency_key; return v_id; end if;
 foreach v_user in array p_approver_ids loop
  v_due:=now()+make_interval(days=>2);
  insert into public.workflow_steps(workflow_id,step_order,assignee_user_id,permission_code,authority_code,status,due_at)
  values(v_id,v_step,v_user,p_permission_code,p_authority_code,case when v_step=1 then 'ACTIVE' else 'PENDING' end,case when v_step=1 then v_due else null end);
  v_step:=v_step+1;
 end loop;
 insert into public.workflow_events(workflow_id,actor_id,event_type,to_status,details)
 values(v_id,(select auth.uid()),'WORKFLOW_STARTED','ACTIVE',jsonb_build_object('approver_count',array_length(p_approver_ids,1),'notifications_should_be_queued_in_parallel',true));
 return v_id;
end $$;
revoke all on function private.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid) from public,anon,authenticated;
grant execute on function private.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid) to authenticated;
create or replace function public.start_project_workflow(
 p_project_id uuid,p_process_type text,p_resource_type text,p_resource_id uuid,p_resource_version text,
 p_approver_ids uuid[],p_permission_code text,p_authority_code text,p_idempotency_key uuid
) returns uuid language sql security invoker set search_path=''
as $$ select private.start_project_workflow(p_project_id,p_process_type,p_resource_type,p_resource_id,p_resource_version,p_approver_ids,p_permission_code,p_authority_code,p_idempotency_key); $$;
revoke all on function public.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid) from public,anon;
grant execute on function public.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid) to authenticated;

create or replace function private.act_project_workflow_step(
 p_workflow_id uuid,p_step_id uuid,p_action text,p_reason text,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_workflow public.workflow_instances; v_step public.workflow_steps; v_next public.workflow_steps; v_amount numeric; v_currency text; v_scope jsonb;
begin
 select * into v_workflow from public.workflow_instances where id=p_workflow_id for update;
 if not found or v_workflow.status<>'ACTIVE' or v_workflow.expected_version<>p_expected_version then raise exception 'Workflow missing, inactive or stale version'; end if;
 select * into v_step from public.workflow_steps where id=p_step_id and workflow_id=p_workflow_id for update;
 if not found or v_step.status<>'ACTIVE' or v_step.assignee_user_id<>(select auth.uid()) then raise exception 'Only the active assigned approver may act'; end if;
 if p_action not in ('APPROVE','REJECT','RETURN') then raise exception 'Invalid workflow action'; end if;
 if p_action in ('REJECT','RETURN') and length(trim(coalesce(p_reason,'')))<8 then raise exception 'Reason is required for rejection or return'; end if;
 if not private.has_project_permission(v_workflow.project_id,'workflow.step.act') then raise exception 'Workflow step permission required'; end if;
 if v_step.authority_code is not null and not private.has_project_authority(v_workflow.project_id,v_step.authority_code,null,null,'{}'::jsonb) then raise exception 'Required business authority is not assigned or has expired'; end if;
 update public.workflow_steps set status=case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end,
  action=p_action,reason=nullif(trim(p_reason),''),acted_at=now() where id=p_step_id;
 if p_action='APPROVE' then
  select * into v_next from public.workflow_steps where workflow_id=p_workflow_id and step_order=v_step.step_order+1 for update;
  if found then
   update public.workflow_steps set status='ACTIVE',due_at=now()+interval '2 days' where id=v_next.id;
   update public.workflow_instances set active_step_order=v_next.step_order,expected_version=expected_version+1,updated_at=now() where id=p_workflow_id;
  else
   update public.workflow_instances set status='COMPLETED',expected_version=expected_version+1,updated_at=now(),completed_at=now() where id=p_workflow_id;
  end if;
 else
  update public.workflow_instances set status=case p_action when 'REJECT' then 'REJECTED' else 'RETURNED' end,expected_version=expected_version+1,updated_at=now(),completed_at=case when p_action='REJECT' then now() else null end where id=p_workflow_id;
 end if;
 insert into public.workflow_events(workflow_id,step_id,actor_id,event_type,from_status,to_status,reason,details)
 values(p_workflow_id,p_step_id,(select auth.uid()),'STEP_'||p_action,'ACTIVE',case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end,
 nullif(trim(p_reason),''),jsonb_build_object('step_order',v_step.step_order,'expected_version',p_expected_version));
 return jsonb_build_object('workflow_id',p_workflow_id,'action',p_action,'step_order',v_step.step_order);
end $$;
revoke all on function private.act_project_workflow_step(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function private.act_project_workflow_step(uuid,uuid,text,text,integer) to authenticated;
create or replace function public.act_project_workflow_step(
 p_workflow_id uuid,p_step_id uuid,p_action text,p_reason text,p_expected_version integer
) returns jsonb language sql security invoker set search_path=''
as $$ select private.act_project_workflow_step(p_workflow_id,p_step_id,p_action,p_reason,p_expected_version); $$;
revoke all on function public.act_project_workflow_step(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.act_project_workflow_step(uuid,uuid,text,text,integer) to authenticated;

create or replace function private.appoint_project_signatory(
 p_membership_id uuid,p_project_id uuid,p_document_type text,p_scope jsonb,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_member public.company_memberships; v_project public.projects; v_id uuid;
begin
 select * into v_project from public.projects where id=p_project_id and status='ACTIVE';
 select * into v_member from public.company_memberships where id=p_membership_id and membership_status='ACTIVE';
 if not found or v_project.id is null or v_member.workspace_id<>v_project.workspace_id or not private.is_company_super_admin(v_project.workspace_id) then raise exception 'Company Super Admin, active Company Member and same-tenant Project required'; end if;
 if length(trim(coalesce(p_document_type,'')))<2 or length(trim(coalesce(p_reason,'')))<8 then raise exception 'Document type and reason are required'; end if;
 if p_ends_at is not null and p_ends_at<=coalesce(p_starts_at,now()) then raise exception 'Invalid appointment period'; end if;
 update public.project_signatory_appointments set status='REVOKED',ends_at=coalesce(ends_at,now())
 where company_membership_id=p_membership_id and project_id=p_project_id and document_type=p_document_type and status='ACTIVE';
 insert into public.project_signatory_appointments(company_id,workspace_id,project_id,company_membership_id,user_id,document_type,scope,starts_at,ends_at,appointed_by,reason)
 values(v_member.company_id,v_member.workspace_id,p_project_id,v_member.id,v_member.user_id,trim(p_document_type),coalesce(p_scope,'{}'::jsonb),coalesce(p_starts_at,now()),p_ends_at,(select auth.uid()),trim(p_reason))
 returning id into v_id;
 insert into public.audit_logs(actor_id,workspace_id,project_id,action,entity_type,entity_id,details)
 values((select auth.uid()),v_member.workspace_id,p_project_id,'project.final_signatory.appointed','project_signatory_appointment',v_id::text,
 jsonb_build_object('membership_id',v_member.id,'user_id',v_member.user_id,'document_type',p_document_type,'scope',coalesce(p_scope,'{}'::jsonb),'reason',trim(p_reason)));
 return v_id;
end $$;
revoke all on function private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) to authenticated;
create or replace function public.appoint_project_signatory(
 p_membership_id uuid,p_project_id uuid,p_document_type text,p_scope jsonb default '{}'::jsonb,p_starts_at timestamptz default now(),p_ends_at timestamptz default null,p_reason text default null
) returns uuid language sql security invoker set search_path=''
as $$ select private.appoint_project_signatory(p_membership_id,p_project_id,p_document_type,p_scope,p_starts_at,p_ends_at,p_reason); $$;
revoke all on function public.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text) to authenticated;

-- 9. Project-scoped, audited BOQ batch import; legacy global importer remains inaccessible after this migration.
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
revoke all on function private.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) to authenticated;
create or replace function public.import_boq_master_batch_scoped(
 p_workspace_id uuid,p_project_id uuid,p_sections jsonb,p_items jsonb,p_reason text
) returns jsonb language sql security invoker set search_path=''
as $$ select private.import_boq_master_batch_scoped(p_workspace_id,p_project_id,p_sections,p_items,p_reason); $$;
revoke all on function public.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.import_boq_master_batch_scoped(uuid,uuid,jsonb,jsonb,text) to authenticated;
revoke all on function public.import_boq_master_batch(jsonb,jsonb,text) from public,anon,authenticated;

commit;

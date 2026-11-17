-- Company Profile change requests: tenant-admin submission, Platform Super Admin approval.
create table if not exists public.company_profile_change_requests (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 requested_by uuid not null references auth.users(id) on delete restrict,
 proposed_legal_name text,
 change_npwp boolean not null default false,
 proposed_npwp_ciphertext text,
 proposed_npwp_last4 text,
 proposed_npwp_fingerprint text,
 reason text not null,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 review_notes text,
 created_at timestamptz not null default now(),
 constraint company_profile_change_payload_check check (
  proposed_legal_name is not null or change_npwp
 ),
 constraint company_profile_change_npwp_payload_check check (
  (change_npwp and proposed_npwp_ciphertext is not null and proposed_npwp_last4 is not null and proposed_npwp_fingerprint is not null)
  or (not change_npwp and proposed_npwp_ciphertext is null and proposed_npwp_last4 is null and proposed_npwp_fingerprint is null)
 ),
 constraint company_profile_change_review_check check (
  (status='PENDING' and reviewed_by is null and reviewed_at is null)
  or (status in ('APPROVED','REJECTED') and reviewed_by is not null and reviewed_at is not null)
 )
);
create unique index if not exists company_profile_change_one_pending_per_company
 on public.company_profile_change_requests(company_id) where status='PENDING';
create index if not exists company_profile_change_workspace_created_idx
 on public.company_profile_change_requests(workspace_id,created_at desc);
alter table public.company_profile_change_requests enable row level security;
drop policy if exists company_profile_change_requests_read on public.company_profile_change_requests;
create policy company_profile_change_requests_read on public.company_profile_change_requests
 for select to authenticated using (
  private.is_platform_super_admin()
  or exists (
   select 1 from public.company_memberships m
   where m.company_id=company_profile_change_requests.company_id
    and m.user_id=(select auth.uid()) and m.membership_status='ACTIVE'
  )
 );
revoke all on public.company_profile_change_requests from public,anon,authenticated;
grant select (id,company_id,workspace_id,requested_by,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,reviewed_by,reviewed_at,review_notes,created_at) on public.company_profile_change_requests to authenticated;

create or replace function private.request_company_profile_change(
 p_company_id uuid,p_legal_name text,p_npwp text,p_change_npwp boolean,p_reason text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 v_company public.companies%rowtype;
 v_workspace_id uuid;
 v_legal_name text:=nullif(pg_catalog.btrim(coalesce(p_legal_name,'')),'');
 v_reason text:=pg_catalog.btrim(coalesce(p_reason,''));
 v_npwp text;
 v_fingerprint text;
 v_ciphertext text;
 v_id uuid;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if p_company_id is null then raise exception 'Company is required'; end if;
 if pg_catalog.length(v_reason) not between 8 and 500 then raise exception 'Reason must contain 8-500 characters'; end if;
 if v_legal_name is not null and pg_catalog.length(v_legal_name) not between 2 and 200 then raise exception 'Legal name must contain 2-200 characters'; end if;
 select w.id into v_workspace_id from public.workspaces w where w.company_id=p_company_id and w.workspace_type='COMPANY';
 if v_workspace_id is null or not private.is_company_super_admin(v_workspace_id) then raise exception 'Active Company Super Admin required'; end if;
 select * into v_company from public.companies where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 if v_legal_name is not null and v_legal_name=v_company.legal_name then v_legal_name:=null; end if;
 if coalesce(p_change_npwp,false) then
  v_npwp:=private.normalize_npwp(p_npwp);
  v_fingerprint:=encode(extensions.hmac(convert_to(v_npwp,'UTF8'),convert_to(private.npwp_derive_key('fingerprint'),'UTF8'),'sha256'),'hex');
  if v_fingerprint is not distinct from v_company.npwp_fingerprint then raise exception 'NPWP baru sama dengan NPWP saat ini'; end if;
  if exists(select 1 from public.companies c where c.npwp_fingerprint=v_fingerprint and c.id<>p_company_id)
     or exists(select 1 from public.company_profile_change_requests r where r.proposed_npwp_fingerprint=v_fingerprint and r.status='PENDING' and r.company_id<>p_company_id)
     or exists(select 1 from public.company_registration_requests r where r.npwp_fingerprint=v_fingerprint) then
    raise exception 'NPWP sudah digunakan atau sedang diajukan oleh perusahaan lain';
  end if;
  v_ciphertext:=encode(extensions.pgp_sym_encrypt(v_npwp,private.npwp_derive_key('encryption'),'cipher-algo=aes256,compress-algo=0'),'base64');
 end if;
 if v_legal_name is null and not coalesce(p_change_npwp,false) then raise exception 'Tidak ada perubahan identitas baru'; end if;
 insert into public.company_profile_change_requests(company_id,workspace_id,requested_by,proposed_legal_name,change_npwp,proposed_npwp_ciphertext,proposed_npwp_last4,proposed_npwp_fingerprint,reason)
 values(p_company_id,v_workspace_id,(select auth.uid()),v_legal_name,coalesce(p_change_npwp,false),v_ciphertext,case when p_change_npwp then right(v_npwp,4) end,v_fingerprint,v_reason)
 returning id into v_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id)
 values((select auth.uid()),'COMPANY_PROFILE_CHANGE_REQUESTED','company_profile_change_requests',v_id::text,
  pg_catalog.jsonb_build_object('company_id',p_company_id,'proposed_legal_name',v_legal_name,'change_npwp',coalesce(p_change_npwp,false),'npwp_last4',case when p_change_npwp then right(v_npwp,4) end,'reason',v_reason),v_workspace_id);
 return v_id;
end $$;
revoke all on function private.request_company_profile_change(uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function private.request_company_profile_change(uuid,text,text,boolean,text) to authenticated;
create or replace function public.request_company_profile_change(p_company_id uuid,p_legal_name text,p_npwp text,p_change_npwp boolean,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
 select private.request_company_profile_change(p_company_id,p_legal_name,p_npwp,p_change_npwp,p_reason)
$$;
revoke all on function public.request_company_profile_change(uuid,text,text,boolean,text) from public,anon;
grant execute on function public.request_company_profile_change(uuid,text,text,boolean,text) to authenticated;

create or replace function private.review_company_profile_change(
 p_request_id uuid,p_decision text,p_review_notes text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_request public.company_profile_change_requests%rowtype;
 v_notes text:=nullif(pg_catalog.btrim(coalesce(p_review_notes,'')),'');
begin
 if (select auth.uid()) is null or not private.is_platform_super_admin() then raise exception 'Platform Super Admin required'; end if;
 if p_decision not in ('APPROVE','REJECT') then raise exception 'Decision must be APPROVE or REJECT'; end if;
 if v_notes is not null and pg_catalog.length(v_notes)>1000 then raise exception 'Review notes cannot exceed 1000 characters'; end if;
 select * into v_request from public.company_profile_change_requests where id=p_request_id for update;
 if not found then raise exception 'Profile change request not found'; end if;
 if v_request.status<>'PENDING' then raise exception 'Profile change request is no longer pending'; end if;
 if p_decision='APPROVE' then
  update public.companies set
   legal_name=coalesce(v_request.proposed_legal_name,legal_name),
   npwp_ciphertext=case when v_request.change_npwp then v_request.proposed_npwp_ciphertext else npwp_ciphertext end,
   npwp_last4=case when v_request.change_npwp then v_request.proposed_npwp_last4 else npwp_last4 end,
   npwp_fingerprint=case when v_request.change_npwp then v_request.proposed_npwp_fingerprint else npwp_fingerprint end,
   updated_at=pg_catalog.now()
  where id=v_request.company_id;
  update public.company_profile_change_requests set status='APPROVED',reviewed_by=(select auth.uid()),reviewed_at=pg_catalog.now(),review_notes=v_notes where id=p_request_id;
 else
  update public.company_profile_change_requests set status='REJECTED',reviewed_by=(select auth.uid()),reviewed_at=pg_catalog.now(),review_notes=v_notes where id=p_request_id;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id)
 values((select auth.uid()),case when p_decision='APPROVE' then 'COMPANY_PROFILE_CHANGE_APPROVED' else 'COMPANY_PROFILE_CHANGE_REJECTED' end,
  'company_profile_change_requests',p_request_id::text,
  pg_catalog.jsonb_build_object('company_id',v_request.company_id,'decision',p_decision,'legal_name_changed',v_request.proposed_legal_name is not null,'npwp_changed',v_request.change_npwp,'npwp_last4',v_request.proposed_npwp_last4,'review_notes',v_notes),v_request.workspace_id);
 return pg_catalog.jsonb_build_object('ok',true,'request_id',p_request_id,'status',case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end);
end $$;
revoke all on function private.review_company_profile_change(uuid,text,text) from public,anon,authenticated;
grant execute on function private.review_company_profile_change(uuid,text,text) to authenticated;
create or replace function public.review_company_profile_change(p_request_id uuid,p_decision text,p_review_notes text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.review_company_profile_change(p_request_id,p_decision,p_review_notes)
$$;
revoke all on function public.review_company_profile_change(uuid,text,text) from public,anon;
grant execute on function public.review_company_profile_change(uuid,text,text) to authenticated;

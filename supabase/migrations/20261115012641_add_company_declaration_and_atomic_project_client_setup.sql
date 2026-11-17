-- Reconciled source for Production migration 20261115012641.
alter table public.company_registration_requests
 add column if not exists declaration_version text,
 add column if not exists declaration_accepted_at timestamptz;
alter table public.company_registration_requests
 add constraint company_registration_declaration_version_check
 check (declaration_version is null or declaration_version='CV-COMPANY-IDENTITY-v1');

create or replace function private.submit_company_registration(
 p_legal_name text,p_npwp text,p_super_admin_email text,
 p_business_email text default null,p_notes text default null,p_declaration_version text default null
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_npwp text; v_fingerprint text; v_ciphertext text; v_super_email text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_legal_name is null or length(trim(p_legal_name)) not between 2 and 200 then raise exception 'Nama legal perusahaan wajib 2-200 karakter' using errcode='22023'; end if;
 v_super_email:=lower(trim(coalesce(p_super_admin_email,'')));
 if length(v_super_email)>254 or v_super_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Email calon Company Super Admin wajib valid' using errcode='22023'; end if;
 if p_business_email is not null and (length(trim(p_business_email))>254 or trim(p_business_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then raise exception 'Format email bisnis tidak valid' using errcode='22023'; end if;
 if p_declaration_version is distinct from 'CV-COMPANY-IDENTITY-v1' then raise exception 'Pernyataan tanggung jawab registrasi wajib disetujui dan versinya harus didukung' using errcode='22023'; end if;
 v_npwp:=private.normalize_npwp(p_npwp);
 v_fingerprint:=encode(extensions.hmac(convert_to(v_npwp,'UTF8'),convert_to(private.npwp_derive_key('fingerprint'),'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_fingerprint,0));
 if exists(select 1 from public.company_registration_requests where npwp_fingerprint=v_fingerprint) or exists(select 1 from public.companies where npwp_fingerprint=v_fingerprint) then raise exception 'NPWP sudah pernah digunakan untuk pendaftaran perusahaan' using errcode='23505'; end if;
 v_ciphertext:=encode(extensions.pgp_sym_encrypt(v_npwp,private.npwp_derive_key('encryption'),'cipher-algo=aes256,compress-algo=0'),'base64');
 insert into public.company_registration_requests(requested_by,legal_name,npwp_ciphertext,npwp_last4,npwp_fingerprint,super_admin_email,business_email,notes,status,declaration_version,declaration_accepted_at)
 values((select auth.uid()),trim(p_legal_name),v_ciphertext,right(v_npwp,4),v_fingerprint,v_super_email,nullif(lower(trim(p_business_email)),''),nullif(trim(p_notes),''),'PENDING',p_declaration_version,now())
 returning id into v_id;
 return v_id;
end $$;
revoke all on function private.submit_company_registration(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.submit_company_registration(text,text,text,text,text,text) to authenticated;
create or replace function public.submit_company_registration(p_legal_name text,p_npwp text,p_super_admin_email text,p_business_email text default null,p_notes text default null,p_declaration_version text default null)
returns uuid language sql security invoker set search_path=''
as $$ select private.submit_company_registration(p_legal_name,p_npwp,p_super_admin_email,p_business_email,p_notes,p_declaration_version) $$;
revoke all on function public.submit_company_registration(text,text,text,text,text,text) from public,anon;
grant execute on function public.submit_company_registration(text,text,text,text,text,text) to authenticated;

create or replace function private.review_company_registration(p_request_id uuid,p_decision text,p_review_notes text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_req public.company_registration_requests%rowtype; v_company uuid; v_workspace uuid; v_seat_email text;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.platform_admins pa where pa.user_id=(select auth.uid())) then raise exception 'Platform Super Admin required' using errcode='42501'; end if;
 if p_decision not in ('ACCEPTED','REJECTED') then raise exception 'Decision must be ACCEPTED or REJECTED' using errcode='22023'; end if;
 select * into v_req from public.company_registration_requests where id=p_request_id for update;
 if not found or v_req.status<>'PENDING' then raise exception 'Request not pending or not found' using errcode='P0002'; end if;
 if p_decision='REJECTED' then update public.company_registration_requests set status='REJECTED',reviewed_by=(select auth.uid()),reviewed_at=now(),review_notes=nullif(trim(p_review_notes),'') where id=p_request_id; return null; end if;
 v_seat_email:=lower(trim(coalesce(v_req.super_admin_email,'')));
 if length(v_seat_email)>254 or v_seat_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Designated Company Super Admin email is invalid' using errcode='22023'; end if;
 if exists(select 1 from public.companies c where c.npwp_fingerprint=v_req.npwp_fingerprint) then raise exception 'Company NPWP is already registered' using errcode='23505'; end if;
 if exists(select 1 from public.company_admin_seats s where lower(s.recipient_email)=v_seat_email and s.seat_status='UNCLAIMED') then raise exception 'Designated claimant already has an unclaimed Company Super Admin seat' using errcode='23505'; end if;
 insert into public.companies(legal_name,npwp_ciphertext,npwp_last4,npwp_fingerprint,registration_status,created_by)
 values(v_req.legal_name,v_req.npwp_ciphertext,v_req.npwp_last4,v_req.npwp_fingerprint,'CLAIM_PENDING',v_req.requested_by) returning id into v_company;
 insert into public.workspaces(workspace_type,display_name,company_id,status) values('COMPANY',v_req.legal_name,v_company,'CLAIM_PENDING') returning id into v_workspace;
 insert into public.company_admin_seats(company_id,recipient_email,seat_status) values(v_company,v_seat_email,'UNCLAIMED');
 update public.company_registration_requests set status='ACCEPTED',reviewed_by=(select auth.uid()),reviewed_at=now(),review_notes=nullif(trim(p_review_notes),'') where id=p_request_id;
 return v_company;
end $$;
create or replace function public.review_company_registration(p_request_id uuid,p_decision text,p_review_notes text default null)
returns uuid language sql security invoker set search_path=''
as $$ select private.review_company_registration(p_request_id,p_decision,p_review_notes) $$;
revoke all on function private.review_company_registration(uuid,text,text) from public,anon;
grant execute on function private.review_company_registration(uuid,text,text) to authenticated;
revoke all on function public.review_company_registration(uuid,text,text) from public,anon;
grant execute on function public.review_company_registration(uuid,text,text) to authenticated;

create or replace function private.create_company_project_with_client(p_workspace_id uuid,p_project_code text,p_name text,p_description text,p_client_name text,p_relationship_type text default 'CLIENT',p_commercial_reference text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid;
begin
 if (select auth.uid()) is null or not private.is_company_super_admin(p_workspace_id) then raise exception 'Active Company Super Admin required' using errcode='42501'; end if;
 if not exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.workspace_type='COMPANY' and w.status='ACTIVE') then raise exception 'Active Company Workspace required' using errcode='22023'; end if;
 if p_client_name is null or length(trim(p_client_name)) not between 2 and 200 then raise exception 'Client name must contain 2-200 characters' using errcode='22023'; end if;
 if p_relationship_type not in ('CLIENT','OWNER','CONSULTANT','OTHER') then raise exception 'Invalid project relationship type' using errcode='22023'; end if;
 v_project_id:=private.create_company_project(p_workspace_id,p_project_code,p_name,p_description);
 insert into public.project_client_relationships(project_id,client_name,relationship_type,commercial_reference,notes)
 values(v_project_id,trim(p_client_name),p_relationship_type,nullif(trim(p_commercial_reference),''),nullif(trim(p_notes),''));
 return v_project_id;
end $$;
revoke all on function private.create_company_project_with_client(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.create_company_project_with_client(uuid,text,text,text,text,text,text,text) to authenticated;
create or replace function public.create_company_project_with_client(p_workspace_id uuid,p_project_code text,p_name text,p_description text,p_client_name text,p_relationship_type text default 'CLIENT',p_commercial_reference text default null,p_notes text default null)
returns uuid language sql security invoker set search_path=''
as $$ select private.create_company_project_with_client(p_workspace_id,p_project_code,p_name,p_description,p_client_name,p_relationship_type,p_commercial_reference,p_notes) $$;
revoke all on function public.create_company_project_with_client(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_company_project_with_client(uuid,text,text,text,text,text,text,text) to authenticated;

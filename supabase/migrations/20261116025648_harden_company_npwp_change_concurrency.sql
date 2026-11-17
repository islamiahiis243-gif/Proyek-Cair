-- Serialize NPWP changes across registration and profile-update flows.
create unique index if not exists company_profile_change_pending_npwp_fingerprint_uidx
 on public.company_profile_change_requests(proposed_npwp_fingerprint)
 where status='PENDING' and change_npwp;

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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_fingerprint,0));
  if v_fingerprint is not distinct from v_company.npwp_fingerprint then raise exception 'NPWP baru sama dengan NPWP saat ini'; end if;
  if exists(select 1 from public.companies c where c.npwp_fingerprint=v_fingerprint and c.id<>p_company_id)
   or exists(select 1 from public.company_profile_change_requests r where r.proposed_npwp_fingerprint=v_fingerprint and r.status='PENDING' and r.company_id<>p_company_id)
   or exists(select 1 from public.company_registration_requests r where r.npwp_fingerprint=v_fingerprint) then raise exception 'NPWP sudah digunakan atau sedang diajukan oleh perusahaan lain'; end if;
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

-- Legacy overload does not capture the SSOT declaration acceptance and must not be callable.
revoke all on function private.submit_company_registration(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.submit_company_registration(text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.submit_company_registration(text,text,text,text,text,text) to authenticated;
grant execute on function public.submit_company_registration(text,text,text,text,text,text) to authenticated;

create or replace function private.submit_company_registration(
 p_legal_name text,p_npwp text,p_super_admin_email text,p_business_email text default null,p_notes text default null,p_declaration_version text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 v_id uuid; v_npwp text; v_fingerprint text; v_ciphertext text; v_super_email text;
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
 if exists(select 1 from public.company_registration_requests where npwp_fingerprint=v_fingerprint)
  or exists(select 1 from public.companies where npwp_fingerprint=v_fingerprint)
  or exists(select 1 from public.company_profile_change_requests where proposed_npwp_fingerprint=v_fingerprint and status='PENDING' and change_npwp) then
  raise exception 'NPWP sudah pernah digunakan untuk pendaftaran perusahaan' using errcode='23505';
 end if;
 v_ciphertext:=encode(extensions.pgp_sym_encrypt(v_npwp,private.npwp_derive_key('encryption'),'cipher-algo=aes256,compress-algo=0'),'base64');
 insert into public.company_registration_requests(requested_by,legal_name,npwp_ciphertext,npwp_last4,npwp_fingerprint,super_admin_email,business_email,notes,status,declaration_version,declaration_accepted_at)
 values((select auth.uid()),trim(p_legal_name),v_ciphertext,right(v_npwp,4),v_fingerprint,v_super_email,nullif(lower(trim(p_business_email)),''),nullif(trim(p_notes),''),'PENDING',p_declaration_version,now())
 returning id into v_id;
 return v_id;
end $$;

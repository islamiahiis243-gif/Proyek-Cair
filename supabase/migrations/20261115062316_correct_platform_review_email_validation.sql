create or replace function private.review_company_registration(p_request_id uuid,p_decision text,p_review_notes text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_req public.company_registration_requests%rowtype;v_company uuid;v_workspace uuid;v_seat_email text;v_notes text;
begin
if (select auth.uid()) is null or not private.is_platform_super_admin() then raise exception 'Platform Super Admin required' using errcode='42501';end if;
if p_decision not in ('ACCEPTED','REJECTED') then raise exception 'Decision must be ACCEPTED or REJECTED' using errcode='22023';end if;
v_notes:=nullif(left(trim(coalesce(p_review_notes,'')),2000),'');select * into v_req from public.company_registration_requests where id=p_request_id for update;
if not found or v_req.status<>'PENDING' then raise exception 'Request not pending or not found' using errcode='P0002';end if;
if p_decision='ACCEPTED' then v_seat_email:=lower(trim(coalesce(v_req.super_admin_email,'')));
if length(v_seat_email)>254 or v_seat_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$' then raise exception 'Designated Company Super Admin email is invalid' using errcode='22023';end if;
if exists(select 1 from public.companies c where c.npwp_fingerprint=v_req.npwp_fingerprint) then raise exception 'Company NPWP is already registered' using errcode='23505';end if;
if exists(select 1 from public.company_admin_seats s where lower(s.recipient_email)=v_seat_email and s.seat_status='UNCLAIMED') then raise exception 'Designated claimant already has an unclaimed Company Super Admin seat' using errcode='23505';end if;
insert into public.companies(legal_name,npwp_ciphertext,npwp_last4,npwp_fingerprint,registration_status,created_by) values(v_req.legal_name,v_req.npwp_ciphertext,v_req.npwp_last4,v_req.npwp_fingerprint,'CLAIM_PENDING',v_req.requested_by) returning id into v_company;
insert into public.workspaces(workspace_type,display_name,company_id,status) values('COMPANY',v_req.legal_name,v_company,'CLAIM_PENDING') returning id into v_workspace;
insert into public.company_admin_seats(company_id,recipient_email,seat_status) values(v_company,v_seat_email,'UNCLAIMED');end if;
update public.company_registration_requests set status=p_decision,reviewed_by=(select auth.uid()),reviewed_at=now(),review_notes=v_notes where id=p_request_id;
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),case when p_decision='ACCEPTED' then 'company_registration.accepted' else 'company_registration.rejected' end,'company_registration_request',p_request_id::text,jsonb_strip_nulls(jsonb_build_object('legal_name',v_req.legal_name,'decision',p_decision,'company_id',v_company,'workspace_id',v_workspace,'review_notes',v_notes)));
return v_company;end;$$;

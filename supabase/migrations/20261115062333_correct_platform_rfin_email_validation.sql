create or replace function private.issue_rfin_a(p_company_id uuid,p_recipient_email text,p_expires_in interval default interval '7 days') returns text language plpgsql security definer set search_path='' as $$
declare v_code text;v_email text;v_seat public.company_admin_seats%rowtype;
begin
if (select auth.uid()) is null or not private.is_platform_super_admin() then raise exception 'Platform Super Admin required' using errcode='42501';end if;
v_email:=lower(trim(coalesce(p_recipient_email,'')));if length(v_email)>254 or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$' then raise exception 'Valid recipient email required' using errcode='22023';end if;
if p_expires_in<=interval '0' or p_expires_in>interval '30 days' then raise exception 'Expiry must be 1-30 days';end if;
perform 1 from public.companies where id=p_company_id and registration_status='CLAIM_PENDING' for update;if not found then raise exception 'Company must be CLAIM_PENDING' using errcode='P0002';end if;
select * into v_seat from public.company_admin_seats where company_id=p_company_id for update;if not found or v_seat.seat_status<>'UNCLAIMED' then raise exception 'Company Super Admin seat is not unclaimed' using errcode='23514';end if;
if lower(v_seat.recipient_email)<>v_email then raise exception 'Recipient must match the designated Company Super Admin seat' using errcode='22023';end if;
if exists(select 1 from public.company_memberships where company_id=p_company_id and membership_status='ACTIVE' and is_company_super_admin) then raise exception 'Company already has an active Super Admin' using errcode='23505';end if;
update public.rfin_tokens set revoked_at=now() where company_id=p_company_id and token_class='RFIN_A' and redeemed_at is null and revoked_at is null;
v_code:='RFA-'||upper(encode(extensions.gen_random_bytes(24),'hex'));insert into public.rfin_tokens(token_class,token_hash,company_id,recipient_email,issued_by,expires_at) values('RFIN_A',encode(extensions.digest(v_code,'sha256'),'hex'),p_company_id,v_email,(select auth.uid()),now()+p_expires_in);
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'company_admin_seat.rfin_a_issued','company_admin_seat',p_company_id::text,jsonb_build_object('recipient_email',v_email,'expires_at',now()+p_expires_in));return v_code;end;$$;

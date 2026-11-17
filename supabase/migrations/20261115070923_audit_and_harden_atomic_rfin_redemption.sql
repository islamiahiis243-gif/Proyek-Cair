-- Atomic, auditable RFIN redemption. Never persist or log the presented plaintext code.
create or replace function private.redeem_rfin(p_code text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_token public.rfin_tokens; v_user_email text; v_user_id uuid := (select auth.uid()); v_workspace uuid; v_membership uuid; v_attempt_count integer; v_attempt_id bigint; v_code text := upper(trim(coalesce(p_code,''))); v_seat public.company_admin_seats;
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
 end if;
 select id into v_workspace from public.workspaces where company_id=v_token.company_id and workspace_type='COMPANY';
 if v_workspace is null then return jsonb_build_object('ok',false,'error','Company Workspace unavailable'); end if;
 if v_token.token_class='RFIN_A' then
  if exists(select 1 from public.company_memberships where company_id=v_token.company_id and membership_status='ACTIVE' and is_company_super_admin) then return jsonb_build_object('ok',false,'error','Company Super Admin seat already claimed'); end if;
  insert into public.company_memberships(company_id,workspace_id,user_id,membership_status,is_company_super_admin,activated_at,invited_by) values(v_token.company_id,v_workspace,v_user_id,'ACTIVE',true,now(),v_token.issued_by) returning id into v_membership;
  update public.company_admin_seats set seat_status='CLAIMED',claimed_by=v_user_id,claimed_at=now(),updated_at=now() where company_id=v_token.company_id and seat_status='UNCLAIMED';
  if not found then raise exception 'Company Super Admin seat claim raced or is no longer available' using errcode='23505'; end if;
  update public.companies set registration_status='ACTIVE',updated_at=now() where id=v_token.company_id and registration_status='CLAIM_PENDING';
  if not found then raise exception 'Company activation raced or is no longer available' using errcode='23505'; end if;
  update public.workspaces set status='ACTIVE',updated_at=now() where id=v_workspace and status='CLAIM_PENDING';
  if not found then raise exception 'Company Workspace activation raced or is no longer available' using errcode='23505'; end if;
 else
  insert into public.company_memberships(company_id,workspace_id,user_id,membership_status,is_company_super_admin,activated_at,invited_by) values(v_token.company_id,v_workspace,v_user_id,'ACTIVE',false,now(),v_token.issued_by) on conflict(company_id,user_id) do update set membership_status='ACTIVE',activated_at=now(),invited_by=excluded.invited_by returning id into v_membership;
 end if;
 update public.rfin_tokens set redeemed_at=now(),redeemed_by=v_user_id where id=v_token.id and redeemed_at is null and revoked_at is null;
 if not found then raise exception 'RFIN redemption raced or token is no longer available' using errcode='23505'; end if;
 update public.rfin_redemption_attempts set succeeded=true where id=v_attempt_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(v_user_id,case when v_token.token_class='RFIN_A' then 'company_admin_seat.rfin_a_redeemed' else 'company_membership.rfin_b_redeemed' end,case when v_token.token_class='RFIN_A' then 'company_admin_seat' else 'company_membership' end,coalesce(v_membership::text,v_token.company_id::text),jsonb_build_object('company_id',v_token.company_id,'workspace_id',v_workspace,'membership_id',v_membership,'token_id',v_token.id,'token_class',v_token.token_class));
 return jsonb_build_object('ok',true,'token_class',v_token.token_class,'company_id',v_token.company_id,'workspace_id',v_workspace,'membership_id',v_membership);
end $function$;

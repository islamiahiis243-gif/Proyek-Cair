-- Read-only regression for serialized NPWP registration/profile-change lifecycle.
do $$
declare v_definition text;
begin
 if to_regclass('public.company_profile_change_pending_npwp_fingerprint_uidx') is null then
  raise exception 'Pending profile NPWP fingerprint must be unique';
 end if;
 select pg_get_functiondef('private.request_company_profile_change(uuid,text,text,boolean,text)'::regprocedure) into v_definition;
 if position('pg_advisory_xact_lock' in v_definition)=0 then
  raise exception 'Profile NPWP request must serialize duplicate checks';
 end if;
 select pg_get_functiondef('private.submit_company_registration(text,text,text,text,text,text)'::regprocedure) into v_definition;
 if position('company_profile_change_requests' in v_definition)=0
    or position('CV-COMPANY-IDENTITY-v1' in v_definition)=0
    or position('pg_advisory_xact_lock' in v_definition)=0 then
  raise exception 'Registration must honor pending NPWP profile changes and declaration acceptance';
 end if;
 if has_function_privilege('authenticated','public.submit_company_registration(text,text,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','private.submit_company_registration(text,text,text,text,text)','EXECUTE') then
  raise exception 'Legacy registration overload without declaration must be disabled';
 end if;
 if not has_function_privilege('authenticated','public.submit_company_registration(text,text,text,text,text,text)','EXECUTE') then
  raise exception 'Declared registration overload must remain available';
 end if;
end $$;

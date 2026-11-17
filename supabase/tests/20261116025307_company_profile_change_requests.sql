-- Read-only regression for Company Profile change request and approval.
do $$
declare
 v_definition text;
 v_count integer;
begin
 if to_regclass('public.company_profile_change_requests') is null then
  raise exception 'Company profile change request table is missing';
 end if;
 if not (select relrowsecurity from pg_class where oid='public.company_profile_change_requests'::regclass) then
  raise exception 'Company profile change requests must enforce RLS';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='company_profile_change_requests' and policyname='company_profile_change_requests_read' and qual like '%is_company_super_admin%' and qual like '%is_platform_super_admin%') then
  raise exception 'Profile change request reads must be restricted to Company Super Admin and Platform Super Admin';
 end if;
 if not has_column_privilege('authenticated','public.company_profile_change_requests','proposed_npwp_last4','SELECT')
    or has_column_privilege('authenticated','public.company_profile_change_requests','proposed_npwp_ciphertext','SELECT')
    or has_column_privilege('authenticated','public.company_profile_change_requests','proposed_npwp_fingerprint','SELECT') then
  raise exception 'Authenticated profile request reads must expose only masked NPWP, never ciphertext or fingerprint';
 end if;
 if has_table_privilege('authenticated','public.company_profile_change_requests','INSERT')
    or has_table_privilege('authenticated','public.company_profile_change_requests','UPDATE')
    or has_table_privilege('authenticated','public.company_profile_change_requests','DELETE') then
  raise exception 'Direct authenticated mutations on profile requests must remain revoked';
 end if;
 if not has_function_privilege('authenticated','public.request_company_profile_change(uuid,text,text,boolean,text)','EXECUTE')
    or has_function_privilege('anon','public.request_company_profile_change(uuid,text,text,boolean,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.review_company_profile_change(uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.review_company_profile_change(uuid,text,text)','EXECUTE') then
  raise exception 'Company profile request/review RPC grants are invalid';
 end if;
 select pg_get_functiondef('private.request_company_profile_change(uuid,text,text,boolean,text)'::regprocedure) into v_definition;
 if position('is_company_super_admin' in v_definition)=0
    or position('normalize_npwp' in v_definition)=0
    or position('npwp_derive_key' in v_definition)=0
    or position('pgp_sym_encrypt' in v_definition)=0
    or position('COMPANY_PROFILE_CHANGE_REQUESTED' in v_definition)=0 then
  raise exception 'Company profile submission must require Company Super Admin, encrypt NPWP and audit the request';
 end if;
 select pg_get_functiondef('private.review_company_profile_change(uuid,text,text)'::regprocedure) into v_definition;
 if position('is_platform_super_admin' in v_definition)=0
    or position('COMPANY_PROFILE_CHANGE_APPROVED' in v_definition)=0
    or position('COMPANY_PROFILE_CHANGE_REJECTED' in v_definition)=0 then
  raise exception 'Company profile approval must be Platform Super Admin-only and audited';
 end if;
 select count(*) into v_count from pg_indexes
 where schemaname='public' and tablename='company_profile_change_requests'
  and indexname='company_profile_change_one_pending_per_company';
 if v_count<>1 then raise exception 'Only one pending profile change per Company must be enforced'; end if;
end $$;

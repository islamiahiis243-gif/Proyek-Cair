-- Rollback-only regression for the NPWP Company Super Admin authentication audit.
begin;

do $$
declare
  v_rows integer;
begin
  if pg_catalog.has_function_privilege('anon', 'public.record_company_admin_npwp_login_event(text,text,text,uuid,uuid)', 'EXECUTE') then
    raise exception 'anon must not execute authentication audit writer';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.record_company_admin_npwp_login_event(text,text,text,uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated must not execute authentication audit writer';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.record_company_admin_npwp_login_event(text,text,text,uuid,uuid)', 'EXECUTE') then
    raise exception 'service_role must execute authentication audit writer';
  end if;
  if pg_catalog.has_table_privilege('anon', 'private.company_admin_login_events', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.company_admin_login_events', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'private.company_admin_login_events', 'SELECT') then
    raise exception 'authentication audit events must not be directly readable';
  end if;

  perform private.record_company_admin_npwp_login_event(
    'not-a-valid-npwp', '192.0.2.140', 'INVALID_CREDENTIALS', null, null
  );
  select count(*) into v_rows
  from private.company_admin_login_events
  where outcome = 'INVALID_CREDENTIALS'
    and npwp_hash ~ '^[0-9a-f]{64}$'
    and ip_hash ~ '^[0-9a-f]{64}$';
  if v_rows <> 1 then
    raise exception 'authentication audit event was not written as HMAC-only identifiers';
  end if;

  begin
    perform private.record_company_admin_npwp_login_event(
      '123456789012345', '192.0.2.141', 'SUCCESS', gen_random_uuid(), gen_random_uuid()
    );
    raise exception 'success audit accepted an unverified identity';
  exception when others then
    if sqlerrm = 'success audit accepted an unverified identity' then
      raise;
    end if;
  end;
end
$$;

rollback;

-- Rollback-only regression for the NPWP login broker. No test rows survive.
begin;

do $$
declare
  v_result jsonb;
  i integer;
  v_npwp text;
begin
  if pg_catalog.has_function_privilege('anon', 'public.resolve_company_admin_npwp_login(text,text)', 'EXECUTE') then
    raise exception 'anon must not execute the NPWP login broker';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.resolve_company_admin_npwp_login(text,text)', 'EXECUTE') then
    raise exception 'authenticated must not execute the NPWP login broker';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.resolve_company_admin_npwp_login(text,text)', 'EXECUTE') then
    raise exception 'service_role must execute the NPWP login broker';
  end if;
  if pg_catalog.has_table_privilege('anon', 'private.company_admin_login_attempts', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.company_admin_login_attempts', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'private.company_admin_login_attempts', 'SELECT') then
    raise exception 'login attempt storage must not be directly readable';
  end if;

  v_result := private.resolve_company_admin_npwp_login('not-an-npwp', '192.0.2.10');
  if v_result ? 'email' and v_result->>'email' is not null then
    raise exception 'invalid NPWP must not resolve an email';
  end if;

  -- NPWP-specific limit: the 11th attempt is denied even across distinct IPs.
  for i in 1..10 loop
    v_result := private.resolve_company_admin_npwp_login('123456789012345', '192.0.2.' || (20+i)::text);
    if v_result->>'allowed' <> 'true' then
      raise exception 'NPWP attempt % was denied before the configured limit', i;
    end if;
  end loop;
  v_result := private.resolve_company_admin_npwp_login('123456789012345', '192.0.2.99');
  if v_result->>'allowed' <> 'false' then
    raise exception 'NPWP-specific 15-minute limit was not enforced';
  end if;

  -- IP-specific limit: the 31st attempt is denied across distinct NPWP values.
  for i in 1..30 loop
    v_npwp := pg_catalog.lpad(i::text, 15, '0');
    v_result := private.resolve_company_admin_npwp_login(v_npwp, '198.51.100.77');
    if v_result->>'allowed' <> 'true' then
      raise exception 'IP attempt % was denied before the configured limit', i;
    end if;
  end loop;
  v_result := private.resolve_company_admin_npwp_login('999999999999999', '198.51.100.77');
  if v_result->>'allowed' <> 'false' then
    raise exception 'IP-specific 15-minute limit was not enforced';
  end if;
end
$$;

rollback;

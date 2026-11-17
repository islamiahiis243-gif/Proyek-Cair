-- Rollback-only regression for the legacy caller-bound role lookup.
begin;

do $$
declare
  v_config text[];
  v_is_definer boolean;
  v_expected text;
  v_actual text;
  v_user_id uuid;
begin
  select p.proconfig, p.prosecdef
    into v_config, v_is_definer
  from pg_proc p
  where p.oid = 'public.current_user_role()'::regprocedure;

  if v_is_definer is distinct from true then
    raise exception 'current_user_role must preserve SECURITY DEFINER behavior';
  end if;
  if not (v_config @> array['search_path=""']) then
    raise exception 'current_user_role must use an empty search_path';
  end if;
  if not pg_catalog.has_function_privilege('authenticated','public.current_user_role()','EXECUTE') then
    raise exception 'authenticated legacy caller must retain EXECUTE';
  end if;
  if pg_catalog.has_function_privilege('anon','public.current_user_role()','EXECUTE') then
    raise exception 'anon must not execute current_user_role';
  end if;

  select u.id into v_user_id
  from auth.users u
  where u.email_confirmed_at is not null
  order by u.created_at
  limit 1;

  if v_user_id is not null then
    perform pg_catalog.set_config('request.jwt.claim.sub',v_user_id::text,true);
    select p.role into v_expected
    from public.profiles p
    where p.id=v_user_id and p.is_active is true;
    select public.current_user_role() into v_actual;
    if v_actual is distinct from v_expected then
      raise exception 'current_user_role no longer returns the caller-bound active profile role';
    end if;
  end if;
end
$$;

rollback;

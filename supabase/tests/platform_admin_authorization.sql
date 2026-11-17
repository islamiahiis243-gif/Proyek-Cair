begin;do $$ begin
perform set_config('request.jwt.claim.sub','',true);if private.is_platform_super_admin() then raise exception 'Unauthenticated session unexpectedly has platform authority';end if;
perform set_config('request.jwt.claim.sub','e3d1a0ac-ee6b-4f72-a4b5-34c2f3b3fd17',true);if not private.is_platform_super_admin() then raise exception 'Designated verified owner was not recognized';end if;
perform set_config('request.jwt.claim.sub','fdce06b8-231d-4e67-abb1-46ef812dcfa6',true);if private.is_platform_super_admin() then raise exception 'Ordinary user unexpectedly has platform authority';end if;
if has_function_privilege('anon','private.is_platform_super_admin()','EXECUTE') then raise exception 'anon must not execute helper';end if;
if not has_function_privilege('authenticated','private.is_platform_super_admin()','EXECUTE') then raise exception 'authenticated must evaluate RLS helper';end if;
end $$;rollback;
-- Server-only NPWP Company Super Admin sign-in broker.
-- The browser never receives the internal email lookup; Supabase Auth remains the password verifier.
create table if not exists private.company_admin_login_attempts (
  scope_type text not null check (scope_type in ('IP','NPWP')),
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count > 0),
  primary key (scope_type, scope_hash, bucket_start)
);

create index if not exists company_admin_login_attempts_bucket_idx
  on private.company_admin_login_attempts(bucket_start);

alter table private.company_admin_login_attempts enable row level security;
revoke all on table private.company_admin_login_attempts from public, anon, authenticated, service_role;

create or replace function private.resolve_company_admin_npwp_login(
  p_npwp text,
  p_client_ip text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_npwp text;
  v_rate_value text;
  v_ip inet;
  v_ip_hash text;
  v_npwp_hash text;
  v_bucket timestamptz;
  v_ip_attempts integer;
  v_npwp_attempts integer;
  v_email text;
begin
  -- Missing/unparseable client address fails closed. This is defense in depth;
  -- the NPWP-specific bucket remains effective even if an intermediary changes IPs.
  begin
    if p_client_ip is null or length(trim(p_client_ip)) > 64 then
      return jsonb_build_object('allowed', false, 'email', null);
    end if;
    v_ip := trim(p_client_ip)::inet;
  exception when others then
    return jsonb_build_object('allowed', false, 'email', null);
  end;

  begin
    v_npwp := private.normalize_npwp(coalesce(p_npwp, ''));
  exception when others then
    v_npwp := null;
  end;

  -- Invalid identifiers are still throttled without revealing whether they exist.
  v_rate_value := coalesce(
    v_npwp,
    nullif(left(pg_catalog.regexp_replace(coalesce(p_npwp, ''), '[^0-9]', '', 'g'), 32), ''),
    'INVALID'
  );

  v_bucket := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.clock_timestamp()) / 900) * 900
  );
  v_ip_hash := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_ip::text, 'UTF8'),
      pg_catalog.convert_to(private.npwp_derive_key('login-rate-limit-ip'), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_npwp_hash := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_rate_value, 'UTF8'),
      pg_catalog.convert_to(private.npwp_derive_key('login-rate-limit-npwp'), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into private.company_admin_login_attempts as attempts
    (scope_type, scope_hash, bucket_start, attempt_count)
  values ('IP', v_ip_hash, v_bucket, 1)
  on conflict (scope_type, scope_hash, bucket_start)
  do update set attempt_count = attempts.attempt_count + 1
  returning attempt_count into v_ip_attempts;

  insert into private.company_admin_login_attempts as attempts
    (scope_type, scope_hash, bucket_start, attempt_count)
  values ('NPWP', v_npwp_hash, v_bucket, 1)
  on conflict (scope_type, scope_hash, bucket_start)
  do update set attempt_count = attempts.attempt_count + 1
  returning attempt_count into v_npwp_attempts;

  delete from private.company_admin_login_attempts
  where bucket_start < v_bucket - interval '1 day';

  -- Fixed 15-minute buckets: 30 requests per source IP and 10 per NPWP.
  if v_ip_attempts > 30 or v_npwp_attempts > 10 then
    return jsonb_build_object('allowed', false, 'email', null);
  end if;

  if v_npwp is null then
    return jsonb_build_object('allowed', true, 'email', null);
  end if;

  select pg_catalog.lower(u.email)
    into v_email
  from public.companies c
  join public.company_admin_seats s
    on s.company_id = c.id
  join public.company_memberships m
    on m.company_id = c.id
   and m.user_id = s.claimed_by
  join public.workspaces w
    on w.company_id = c.id
   and w.workspace_type = 'COMPANY'
   and w.id = m.workspace_id
  join auth.users u
    on u.id = s.claimed_by
  where c.npwp_fingerprint = pg_catalog.encode(
          extensions.hmac(
            pg_catalog.convert_to(v_npwp, 'UTF8'),
            pg_catalog.convert_to(private.npwp_derive_key('fingerprint'), 'UTF8'),
            'sha256'
          ),
          'hex'
        )
    and c.registration_status in ('ACTIVE','VERIFIED')
    and s.seat_status = 'CLAIMED'
    and s.claimed_by is not null
    and m.membership_status = 'ACTIVE'
    and m.is_company_super_admin is true
    and w.status = 'ACTIVE'
    and u.email_confirmed_at is not null
    and pg_catalog.lower(u.email) = pg_catalog.lower(s.recipient_email)
  limit 1;

  return jsonb_build_object('allowed', true, 'email', v_email);
end
$$;

-- The wrapper is callable only by the Edge Function's server-side secret key.
create or replace function public.resolve_company_admin_npwp_login(
  p_npwp text,
  p_client_ip text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_company_admin_npwp_login(p_npwp, p_client_ip)
$$;

revoke all on function private.resolve_company_admin_npwp_login(text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_company_admin_npwp_login(text, text) from public, anon, authenticated;
grant execute on function public.resolve_company_admin_npwp_login(text, text) to service_role;

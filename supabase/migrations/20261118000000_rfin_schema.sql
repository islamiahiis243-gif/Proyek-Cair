-- ============================================================
-- RFIN Schema: Tahap 2 - Skema Data RFIN-A & RFIN-B
-- Applied: 2026-11-18
-- ============================================================

-- ============================================================
-- TABEL 1: Pengajuan pendaftaran perusahaan (RFIN-A Request)
-- ============================================================
create table if not exists public.company_registration_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  legal_name text not null,
  npwp text not null,
  npwp_last4 text generated always as (right(npwp, 4)) stored,
  super_admin_email text not null,
  business_email text,
  status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','REJECTED')),
  review_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  declaration_version text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.company_registration_requests enable row level security;

create policy "user_own_requests_select" on public.company_registration_requests
  for select using (requested_by = auth.uid());

create policy "user_insert_requests" on public.company_registration_requests
  for insert with check (requested_by = auth.uid());

create policy "psa_all_requests" on public.company_registration_requests
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
    )
  );

grant select, insert, update on public.company_registration_requests to authenticated;

-- ============================================================
-- TABEL 2: Kursi CSA (Company Admin Seat)
-- ============================================================
create table if not exists public.company_admin_seats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_email text not null,
  seat_status text not null default 'UNCLAIMED' check(seat_status in ('UNCLAIMED','CLAIMED','REVOKED')),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id)
);

alter table public.company_admin_seats enable row level security;

create policy "psa_manage_seats" on public.company_admin_seats
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
    )
  );

create policy "recipient_view_own_seat" on public.company_admin_seats
  for select using (
    recipient_email = (select email from auth.users where id = auth.uid())
  );

grant select, insert, update on public.company_admin_seats to authenticated;

-- ============================================================
-- TABEL 3: Token RFIN (kelas A dan B)
-- ============================================================
create table if not exists public.rfin_tokens (
  id uuid primary key default gen_random_uuid(),
  token_code text not null unique,
  token_class text not null check(token_class in ('RFIN_A','RFIN_B')),
  company_id uuid references public.companies(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  recipient_email text not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id),
  revoked_at timestamptz,
  snapshot jsonb,
  signatory_only boolean not null default false,
  issued_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.rfin_tokens enable row level security;

create policy "token_recipient_select" on public.rfin_tokens
  for select using (
    recipient_email = (select email from auth.users where id = auth.uid())
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
    )
  );

create policy "psa_manage_tokens" on public.rfin_tokens
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
    )
  );

grant select, insert, update on public.rfin_tokens to authenticated;

-- ============================================================
-- RPC 1: submit_company_registration
-- Dipanggil oleh personal user saat mengajukan pendaftaran perusahaan baru (RFIN-A)
-- ============================================================
create or replace function public.submit_company_registration(
  p_legal_name text,
  p_npwp text,
  p_super_admin_email text,
  p_business_email text default null,
  p_notes text default null,
  p_declaration_version text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Autentikasi diperlukan untuk mendaftarkan perusahaan.';
  end if;

  if length(trim(coalesce(p_legal_name,''))) < 2 then
    raise exception 'Nama legal perusahaan minimal 2 karakter.';
  end if;

  if p_npwp !~ '^[0-9]{15,16}$' then
    raise exception 'Format NPWP harus 15 atau 16 digit angka.';
  end if;

  if p_super_admin_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Format email tidak valid.';
  end if;

  -- Cek apakah sudah ada permohonan PENDING dari user ini
  if exists (
    select 1 from public.company_registration_requests
    where requested_by = v_uid and status = 'PENDING'
  ) then
    raise exception 'Anda sudah memiliki permohonan pendaftaran yang sedang menunggu review.';
  end if;

  insert into public.company_registration_requests
    (requested_by, legal_name, npwp, super_admin_email, business_email, notes, declaration_version)
  values
    (
      v_uid,
      trim(upper(p_legal_name)),
      p_npwp,
      lower(trim(p_super_admin_email)),
      case when p_business_email is not null and length(trim(p_business_email)) > 0
           then lower(trim(p_business_email)) else null end,
      p_notes,
      p_declaration_version
    )
  returning id into v_id;

  return v_id;
end $$;

-- ============================================================
-- RPC 2: review_company_registration
-- Dipanggil oleh PSA untuk menerima atau menolak permohonan
-- ============================================================
create or replace function public.review_company_registration(
  p_request_id uuid,
  p_decision text,
  p_review_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_company_id uuid;
  v_workspace_id uuid;
begin
  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'PLATFORM_SUPER_ADMIN'
  ) then
    raise exception 'Hanya Platform Super Admin yang dapat me-review permohonan ini.';
  end if;

  select * into v_req from public.company_registration_requests where id = p_request_id;
  if not found then raise exception 'Permohonan tidak ditemukan.'; end if;
  if v_req.status != 'PENDING' then
    raise exception 'Permohonan ini sudah diproses sebelumnya (status: %).', v_req.status;
  end if;
  if p_decision not in ('ACCEPTED','REJECTED') then
    raise exception 'Keputusan tidak valid. Gunakan ACCEPTED atau REJECTED.';
  end if;

  update public.company_registration_requests
  set status = p_decision,
      review_notes = p_review_notes,
      reviewed_by = v_uid,
      reviewed_at = now()
  where id = p_request_id;

  if p_decision = 'ACCEPTED' then
    insert into public.companies (name, legal_name, npwp, status)
    values (v_req.legal_name, v_req.legal_name, v_req.npwp, 'ACTIVE')
    returning id into v_company_id;

    insert into public.workspaces (workspace_type, display_name, company_id, status)
    values ('COMPANY', v_req.legal_name, v_company_id, 'ACTIVE')
    returning id into v_workspace_id;

    insert into public.company_admin_seats (company_id, recipient_email)
    values (v_company_id, v_req.super_admin_email)
    on conflict (company_id) do nothing;
  end if;
end $$;

-- ============================================================
-- RPC 3: issue_rfin_a
-- PSA terbitkan token RFIN-A untuk calon CSA
-- ============================================================
create or replace function public.issue_rfin_a(
  p_company_id uuid,
  p_recipient_email text,
  p_expires_in interval default '7 days'
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code_raw text;
  v_code_full text;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
  ) then
    raise exception 'Hanya Platform Super Admin yang dapat menerbitkan RFIN-A.';
  end if;

  update public.rfin_tokens
  set revoked_at = now()
  where company_id = p_company_id
    and token_class = 'RFIN_A'
    and redeemed_at is null
    and revoked_at is null;

  v_code_raw := upper(encode(gen_random_bytes(9), 'hex'));
  v_code_full := 'RFA-'
    || substring(v_code_raw, 1, 4) || '-'
    || substring(v_code_raw, 5, 4) || '-'
    || substring(v_code_raw, 9, 4);

  insert into public.rfin_tokens
    (token_code, token_class, company_id, recipient_email, expires_at, issued_by, snapshot)
  values
    (
      v_code_full,
      'RFIN_A',
      p_company_id,
      lower(trim(p_recipient_email)),
      now() + p_expires_in,
      auth.uid(),
      jsonb_build_object(
        'token_class', 'RFIN_A',
        'summary', 'Klaim kursi Company Super Admin',
        'company_id', p_company_id
      )
    );

  return v_code_full;
end $$;

-- ============================================================
-- RPC 4: preview_rfin_redemption
-- Lihat detail token sebelum diklaim (validasi email & expiry)
-- ============================================================
create or replace function public.preview_rfin_redemption(
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_token record;
begin
  if v_uid is null then
    raise exception 'Autentikasi diperlukan.';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_token
  from public.rfin_tokens
  where token_code = upper(trim(p_code))
    and revoked_at is null
    and redeemed_at is null;

  if not found then
    raise exception 'Kode RFIN tidak valid, sudah digunakan, atau telah dicabut.';
  end if;

  if v_token.expires_at < now() then
    raise exception 'Kode RFIN sudah kedaluwarsa pada %.',
      to_char(v_token.expires_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI');
  end if;

  if lower(v_token.recipient_email) != lower(v_user_email) then
    raise exception 'Kode RFIN ini tidak ditujukan untuk akun Anda (%s).', v_user_email;
  end if;

  return coalesce(v_token.snapshot, '{}'::jsonb) || jsonb_build_object(
    'token_class', v_token.token_class,
    'recipient_email', v_token.recipient_email,
    'expires_at', v_token.expires_at,
    'company_id', v_token.company_id,
    'workspace_id', v_token.workspace_id,
    'signatory_only', v_token.signatory_only
  );
end $$;

-- ============================================================
-- RPC 5: redeem_rfin
-- Klaim token RFIN (A atau B) oleh penerima
-- ============================================================
create or replace function public.redeem_rfin(
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_token record;
  v_ws_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Autentikasi diperlukan.');
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_token
  from public.rfin_tokens
  where token_code = upper(trim(p_code))
    and revoked_at is null
    and redeemed_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Kode RFIN tidak valid atau sudah digunakan.');
  end if;

  if v_token.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'Kode RFIN sudah kedaluwarsa.');
  end if;

  if lower(v_token.recipient_email) != lower(v_user_email) then
    return jsonb_build_object('ok', false, 'error', 'Kode RFIN ini tidak ditujukan untuk akun Anda.');
  end if;

  update public.rfin_tokens
  set redeemed_at = now(), redeemed_by = v_uid
  where id = v_token.id;

  if v_token.token_class = 'RFIN_A' then
    update public.company_admin_seats
    set seat_status = 'CLAIMED',
        claimed_by = v_uid,
        claimed_at = now()
    where company_id = v_token.company_id
      and seat_status = 'UNCLAIMED';

    select id into v_ws_id
    from public.workspaces
    where company_id = v_token.company_id
    limit 1;

    insert into public.company_memberships (workspace_id, company_id, user_id, membership_status)
    values (v_ws_id, v_token.company_id, v_uid, 'ACTIVE')
    on conflict (workspace_id, user_id) do nothing;

    return jsonb_build_object(
      'ok', true,
      'token_class', 'RFIN_A',
      'workspace_id', v_ws_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'token_class', 'RFIN_B',
    'workspace_id', v_token.workspace_id
  );
end $$;

-- ============================================================
-- PSA Console Schema: Tahap 3 - Role Catalog, Permission, Mapping, Profile Changes
-- Applied: 2026-11-19
-- ============================================================

-- ============================================================
-- TABEL 1: role_catalog — daftar role yang dikenal sistem
-- ============================================================
create table if not exists public.role_catalog (
  role_code   text primary key,
  display_name text not null,
  description  text not null default '',
  sort_order   int  not null default 99,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.role_catalog enable row level security;

create policy "all_read_role_catalog" on public.role_catalog
  for select using (true);

create policy "psa_manage_role_catalog" on public.role_catalog
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN')
  );

grant select on public.role_catalog to authenticated, anon;
grant insert, update, delete on public.role_catalog to authenticated;

-- Seed data sesuai matrix impersona
insert into public.role_catalog (role_code, display_name, description, sort_order) values
  ('CLERK',          'Clerk / Juru Tulis',  'Entri data dan penerbitan dokumen. Hanya bisa buat, tidak bisa approve.', 10),
  ('FOREMAN',        'Foreman / Mandor',    'Diperiksa & disetujui dokumen pada level lapangan.', 20),
  ('SUPERVISOR',     'Supervisor / Spv.',   'Diperiksa & disetujui dokumen pada level divisi.', 30),
  ('DEPT_MANAGER',   'Dept. Manager',       'Menyetujui dokumen pada level departemen.', 40),
  ('KTT_PM',         'KTT / Proj. Manager', 'Mengetahui dan tanda tangan + QR pada level proyek.', 50),
  ('CEO',            'CEO / Direktur',      'Mengetahui dan tanda tangan + QR pada level perusahaan.', 60)
on conflict (role_code) do nothing;

-- ============================================================
-- TABEL 2: Tambah kolom ke project_permission_catalog (sudah ada tabelnya)
-- ============================================================
alter table public.project_permission_catalog
  add column if not exists module text not null default 'Umum',
  add column if not exists action text not null default 'Lihat',
  add column if not exists requires_authority_check boolean not null default false;

-- Upsert seed permission catalog
insert into public.project_permission_catalog
  (permission_code, display_name, description, module, action, requires_authority_check, active)
values
  ('STOCK_READ',    'Lihat Stok',             'Melihat daftar dan detail stok barang',               'Inventaris', 'Lihat',   false, true),
  ('STOCK_ENTRY',   'Terbitkan Mutasi Barang','Membuat dokumen mutasi barang baru',                  'Inventaris', 'Terbitkan', false, true),
  ('STOCK_CHECK',   'Periksa Mutasi Barang',  'Memeriksa dokumen mutasi (tanda tangan level 1)',     'Inventaris', 'Periksa', true,  true),
  ('STOCK_APPROVE', 'Setujui Mutasi Barang',  'Menyetujui dokumen mutasi (tanda tangan level 2)',    'Inventaris', 'Setujui', true,  true),
  ('STOCK_SIGN',    'TTE+QR Mutasi Barang',   'Mengetahui + tanda tangan elektronik + QR Code',     'Inventaris', 'TTE+QR',  true,  true),
  ('CASH_READ',     'Lihat Kas',              'Melihat daftar dan saldo arus kas',                   'Keuangan',   'Lihat',   false, true),
  ('CASH_ENTRY',    'Terbitkan Mutasi Dana',  'Membuat dokumen mutasi dana baru',                    'Keuangan',   'Terbitkan', false, true),
  ('CASH_CHECK',    'Periksa Mutasi Dana',    'Memeriksa dokumen mutasi dana',                       'Keuangan',   'Periksa', true,  true),
  ('CASH_APPROVE',  'Setujui Mutasi Dana',    'Menyetujui dokumen mutasi dana',                      'Keuangan',   'Setujui', true,  true),
  ('CASH_SIGN',     'TTE+QR Mutasi Dana',     'Mengetahui + tanda tangan elektronik + QR Code',     'Keuangan',   'TTE+QR',  true,  true),
  ('REPORT_READ',   'Lihat Laporan',          'Mengakses laporan dan ekspor PDF',                    'Laporan',    'Lihat',   false, true)
on conflict (permission_code) do update set
  module                   = excluded.module,
  action                   = excluded.action,
  requires_authority_check = excluded.requires_authority_check,
  display_name             = excluded.display_name,
  description              = excluded.description;

-- ============================================================
-- TABEL 3: role_permission_catalog — mapping role → permission
-- ============================================================
create table if not exists public.role_permission_catalog (
  id               uuid primary key default gen_random_uuid(),
  role_code        text not null references public.role_catalog(role_code) on delete cascade,
  permission_code  text not null references public.project_permission_catalog(permission_code) on delete cascade,
  active           boolean not null default true,
  changed_by       uuid references auth.users(id),
  change_reason    text,
  created_at       timestamptz not null default now(),
  unique(role_code, permission_code)
);

alter table public.role_permission_catalog enable row level security;

create policy "all_read_role_perm" on public.role_permission_catalog
  for select using (true);

create policy "psa_manage_role_perm" on public.role_permission_catalog
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN')
  );

grant select on public.role_permission_catalog to authenticated, anon;
grant insert, update, delete on public.role_permission_catalog to authenticated;

-- Seed mapping default sesuai matrix impersona
insert into public.role_permission_catalog (role_code, permission_code, active) values
  ('CLERK',        'STOCK_READ',    true),
  ('CLERK',        'STOCK_ENTRY',   true),
  ('CLERK',        'CASH_READ',     true),
  ('CLERK',        'CASH_ENTRY',    true),
  ('FOREMAN',      'STOCK_READ',    true),
  ('FOREMAN',      'STOCK_CHECK',   true),
  ('FOREMAN',      'CASH_READ',     true),
  ('SUPERVISOR',   'STOCK_READ',    true),
  ('SUPERVISOR',   'STOCK_CHECK',   true),
  ('SUPERVISOR',   'STOCK_APPROVE', true),
  ('SUPERVISOR',   'CASH_READ',     true),
  ('SUPERVISOR',   'CASH_CHECK',    true),
  ('DEPT_MANAGER', 'STOCK_READ',    true),
  ('DEPT_MANAGER', 'STOCK_APPROVE', true),
  ('DEPT_MANAGER', 'CASH_READ',     true),
  ('DEPT_MANAGER', 'CASH_APPROVE',  true),
  ('KTT_PM',       'STOCK_READ',    true),
  ('KTT_PM',       'STOCK_SIGN',    true),
  ('KTT_PM',       'CASH_READ',     true),
  ('KTT_PM',       'CASH_SIGN',     true),
  ('KTT_PM',       'REPORT_READ',   true),
  ('CEO',          'STOCK_READ',    true),
  ('CEO',          'STOCK_SIGN',    true),
  ('CEO',          'CASH_READ',     true),
  ('CEO',          'CASH_SIGN',     true),
  ('CEO',          'REPORT_READ',   true)
on conflict (role_code, permission_code) do nothing;

-- ============================================================
-- TABEL 4: company_profile_change_requests — perubahan nama/NPWP perusahaan
-- ============================================================
create table if not exists public.company_profile_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  requested_by         uuid not null references auth.users(id) on delete cascade,
  proposed_legal_name  text,
  change_npwp          boolean not null default false,
  proposed_npwp        text,
  proposed_npwp_last4  text generated always as (right(proposed_npwp, 4)) stored,
  reason               text not null,
  status               text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
  review_notes         text,
  reviewed_by          uuid references auth.users(id),
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now()
);

alter table public.company_profile_change_requests enable row level security;

create policy "csa_own_company_requests" on public.company_profile_change_requests
  for select using (
    exists (
      select 1 from public.company_memberships cm
      where cm.user_id = auth.uid() and cm.company_id = company_profile_change_requests.company_id
    )
  );

create policy "csa_insert_requests" on public.company_profile_change_requests
  for insert with check (requested_by = auth.uid());

create policy "psa_all_profile_changes" on public.company_profile_change_requests
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN')
  );

grant select, insert on public.company_profile_change_requests to authenticated;

-- ============================================================
-- RPC: set_role_permission_mapping
-- PSA mengaktifkan atau menonaktifkan mapping role-permission
-- ============================================================
create or replace function public.set_role_permission_mapping(
  p_role_code       text,
  p_permission_code text,
  p_active          boolean,
  p_reason          text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'PLATFORM_SUPER_ADMIN'
  ) then
    raise exception 'Hanya Platform Super Admin yang dapat mengubah mapping Role-Permission.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Alasan perubahan mapping wajib minimal 8 karakter.';
  end if;

  insert into public.role_permission_catalog (role_code, permission_code, active, changed_by, change_reason)
  values (p_role_code, p_permission_code, p_active, auth.uid(), p_reason)
  on conflict (role_code, permission_code) do update
    set active        = p_active,
        changed_by    = auth.uid(),
        change_reason = p_reason;
end $$;

-- ============================================================
-- RPC: review_company_profile_change
-- PSA menyetujui atau menolak permohonan perubahan profil perusahaan
-- ============================================================
create or replace function public.review_company_profile_change(
  p_request_id   uuid,
  p_decision     text,
  p_review_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
begin
  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'PLATFORM_SUPER_ADMIN'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Hanya Platform Super Admin yang dapat me-review.');
  end if;

  select * into v_req from public.company_profile_change_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Permohonan tidak ditemukan.');
  end if;
  if v_req.status != 'PENDING' then
    return jsonb_build_object('ok', false, 'error', 'Permohonan ini sudah diproses sebelumnya.');
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    return jsonb_build_object('ok', false, 'error', 'Keputusan tidak valid. Gunakan APPROVE atau REJECT.');
  end if;

  update public.company_profile_change_requests
  set
    status       = case when p_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
    review_notes = p_review_notes,
    reviewed_by  = v_uid,
    reviewed_at  = now()
  where id = p_request_id;

  if p_decision = 'APPROVE' then
    update public.companies
    set
      name       = coalesce(v_req.proposed_legal_name, name),
      legal_name = coalesce(v_req.proposed_legal_name, legal_name),
      npwp       = case when v_req.change_npwp
                        then coalesce(v_req.proposed_npwp, npwp)
                        else npwp
                   end
    where id = v_req.company_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

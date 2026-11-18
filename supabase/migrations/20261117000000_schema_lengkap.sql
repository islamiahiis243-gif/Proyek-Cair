-- ==============================================================================
-- PROYEK CAIR - SKEMA LENGKAP & TERPADU (CONSOLIDATED SCHEMA)
-- ==============================================================================

create extension if not exists pgcrypto;

-- 1. IDENTITAS & PROFIL PENGGUNA
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'admin' check(role in ('admin','site_manager','storekeeper','finance','auditor','viewer')),
  is_active boolean not null default true,
  personal_workspace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. WORKSPACE & PERUSAHAAN (TENANT)
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  npwp text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_type text not null default 'COMPANY' check(workspace_type in ('PERSONAL','COMPANY')),
  display_name text not null,
  owner_user_id uuid references auth.users(id),
  company_id uuid references public.companies(id) on delete set null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_status text not null default 'ACTIVE' check(membership_status in ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, user_id)
);

-- 3. PROYEK & HAK AKSES (PROJECT REGISTRY)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_code text,
  name text not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','ARCHIVED','COMPLETED')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_permission_catalog (
  permission_code text primary key,
  display_name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  company_membership_id uuid references public.company_memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_status text not null default 'ACTIVE' check(membership_status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, user_id)
);

create table if not exists public.project_membership_permissions (
  id uuid primary key default gen_random_uuid(),
  project_membership_id uuid not null references public.project_memberships(id) on delete cascade,
  permission_code text not null references public.project_permission_catalog(permission_code) on delete cascade,
  created_at timestamptz not null default now(),
  unique(project_membership_id, permission_code)
);

-- 4. MASTER BOQ (SECTIONS & ITEMS)
create table if not exists public.boq_sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  source_sheet text not null default 'Trainer & UDU Office',
  source_row integer,
  node_code text not null,
  description text not null,
  level smallint not null default 1 check(level between 1 and 3),
  parent_id uuid references public.boq_sections(id) on delete set null,
  sort_order integer not null default 0,
  source_color text not null default '#000000',
  source_qty numeric default 0,
  source_uom text default '',
  source_total_price numeric default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boq_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  parent_section_id uuid references public.boq_sections(id) on delete set null,
  source_excel_row integer,
  boq_code text not null,
  description text not null,
  category text,
  quantity numeric(18,4) not null default 0 check(quantity >= 0),
  uom text not null,
  unit_rate numeric(18,2) not null default 0 check(unit_rate >= 0),
  remarks text,
  source_sheet text not null default 'Trainer & UDU Office',
  source_row integer,
  is_stock_item boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boq_additions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid not null references public.boq_items(id) on delete cascade,
  quantity numeric(18,4) not null check(quantity > 0),
  reason text not null,
  approval_status text not null default 'DISETUJUI' check(approval_status in ('MENUNGGU','DISETUJUI','DITOLAK')),
  approved_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 5. INVENTARIS & STOK BARANG
create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  idempotency_key uuid not null unique,
  item_id uuid not null references public.boq_items(id) on delete cascade,
  transaction_type text not null check(transaction_type in ('MASUK','KELUAR','PENYESUAIAN_MASUK','PENYESUAIAN_KELUAR')),
  quantity numeric(18,4) not null check(quantity > 0),
  uom text not null,
  occurred_at timestamptz not null default now(),
  reference_no text,
  counterparty text,
  location text,
  notes text,
  source_name text,
  destination_name text,
  recipient_name text,
  owner_type text not null default 'KONTRAKTOR' check(owner_type in ('KONTRAKTOR','IMK')),
  purpose text,
  addition_id uuid references public.boq_additions(id) on delete set null,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_transaction_reversals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  original_transaction_id uuid not null references public.inventory_transactions(id) on delete cascade,
  reversal_transaction_id uuid references public.inventory_transactions(id) on delete cascade,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 6. ARUS KAS (CASHFLOW)
create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  idempotency_key uuid not null unique,
  transaction_type text not null check(transaction_type in ('MASUK','KELUAR')),
  amount numeric(18,2) not null check(amount > 0),
  occurred_at timestamptz not null default now(),
  category text,
  description text not null,
  reference_no text,
  pic text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cash_transaction_reversals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  original_transaction_id uuid not null references public.cash_transactions(id) on delete cascade,
  reversal_transaction_id uuid references public.cash_transactions(id) on delete cascade,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 7. DOKUMEN LAPORAN & VERIFIKASI QR
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  document_no text not null unique,
  title text not null,
  document_type text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','REVIEWED','APPROVED','SIGNED','ISSUED','REJECTED','REVOKED')),
  period_start date,
  period_end date,
  signer_name text,
  signer_role text,
  signer_email text,
  total_transactions integer not null default 0,
  amount_summary numeric(18,2) not null default 0,
  qr_payload text,
  verification_token text,
  storage_path text,
  content_sha256 text,
  snapshot jsonb,
  issued_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 8. AUDIT LOGS
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  project_id uuid,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- 9. DATA KATALOG & SEED AWAL (CV MENARA MEGAH)
-- ==============================================================================

insert into public.project_permission_catalog (permission_code, display_name, description) values
  ('boq.read', 'Lihat BOQ', 'Melihat daftar item dan section BOQ'),
  ('boq.create', 'Tambah BOQ', 'Menambahkan item atau addendum BOQ'),
  ('boq.update', 'Ubah BOQ', 'Mengubah data item BOQ'),
  ('inventory.read', 'Lihat Stok', 'Melihat saldo dan mutasi stok'),
  ('inventory.movement.create', 'Catat Mutasi Stok', 'Mencatat barang masuk/keluar'),
  ('inventory.movement.reverse', 'Koreksi Mutasi Stok', 'Melakukan pembalikan/koreksi mutasi stok'),
  ('cash.read', 'Lihat Arus Kas', 'Melihat transaksi dan saldo kas'),
  ('cash.transaction.create', 'Catat Transaksi Kas', 'Mencatat kas masuk atau keluar'),
  ('cash.transaction.reverse', 'Koreksi Transaksi Kas', 'Melakukan pembalikan transaksi kas'),
  ('document.read', 'Lihat Dokumen', 'Membaca dan mengunduh berkas laporan'),
  ('document.create', 'Buat Dokumen', 'Membuat draft laporan resmi'),
  ('document.sign', 'Tanda Tangan Dokumen', 'Mengesahkan dan menerbitkan dokumen QR')
on conflict (permission_code) do nothing;

-- Inisialisasi Perusahaan & Workspace Bawaan: CV Menara Megah
do $$
declare
  v_company_id uuid;
  v_workspace_id uuid;
  v_project_id uuid;
begin
  -- 1. Pastikan Perusahaan CV Menara Megah ada
  select id into v_company_id from public.companies where name = 'CV Menara Megah' limit 1;
  if v_company_id is null then
    insert into public.companies (name, legal_name, status)
    values ('CV Menara Megah', 'CV Menara Megah Konstruksi', 'ACTIVE')
    returning id into v_company_id;
  end if;

  -- 2. Pastikan Workspace ada
  select id into v_workspace_id from public.workspaces where company_id = v_company_id limit 1;
  if v_workspace_id is null then
    insert into public.workspaces (workspace_type, display_name, company_id, status)
    values ('COMPANY', 'CV Menara Megah', v_company_id, 'ACTIVE')
    returning id into v_workspace_id;
  end if;

  -- 3. Pastikan Project Proyek UDU ada
  select id into v_project_id from public.projects where workspace_id = v_workspace_id and name ilike '%UDU%' limit 1;
  if v_project_id is null then
    insert into public.projects (workspace_id, project_code, name, description, status)
    values (v_workspace_id, 'UDU-01', 'Proyek Kantor & Workshop UDU', 'Proyek Konstruksi CV Menara Megah', 'ACTIVE')
    returning id into v_project_id;
  end if;
end $$;

-- ==============================================================================
-- 10. RPC FUNCTIONS UNTUK APLIKASI
-- ==============================================================================

-- Resolver konteks aktif pengguna
create or replace function public.resolve_my_active_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_workspaces jsonb;
  v_projects jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('authenticated', false);
  end if;

  -- Otomatis pastikan user memiliki keanggotaan pada workspace dan project CV Menara Megah
  insert into public.company_memberships (workspace_id, company_id, user_id, membership_status)
  select w.id, w.company_id, v_uid, 'ACTIVE'
  from public.workspaces w
  where w.company_id is not null
  on conflict (workspace_id, user_id) do nothing;

  insert into public.project_memberships (workspace_id, project_id, user_id, membership_status)
  select p.workspace_id, p.id, v_uid, 'ACTIVE'
  from public.projects p
  on conflict (project_id, user_id) do nothing;

  -- Berikan semua permission kepada user
  insert into public.project_membership_permissions (project_membership_id, permission_code)
  select pm.id, pc.permission_code
  from public.project_memberships pm
  cross join public.project_permission_catalog pc
  where pm.user_id = v_uid
  on conflict (project_membership_id, permission_code) do nothing;

  -- Susun daftar workspaces
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'type', w.workspace_type,
    'name', w.display_name,
    'status', w.status,
    'company_id', w.company_id,
    'access_basis', 'ACTIVE_COMPANY_MEMBERSHIP'
  )), '[]'::jsonb) into v_workspaces
  from public.workspaces w
  where exists (
    select 1 from public.company_memberships cm
    where cm.workspace_id = w.id and cm.user_id = v_uid and cm.membership_status = 'ACTIVE'
  ) or w.owner_user_id = v_uid;

  -- Susun daftar projects beserta seluruh permissions
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'workspace_id', p.workspace_id,
    'project_code', p.project_code,
    'name', p.name,
    'status', p.status,
    'membership_id', pm.id,
    'permissions', coalesce((
      select jsonb_agg(pmp.permission_code)
      from public.project_membership_permissions pmp
      where pmp.project_membership_id = pm.id
    ), '[]'::jsonb)
  )), '[]'::jsonb) into v_projects
  from public.projects p
  join public.project_memberships pm on pm.project_id = p.id and pm.user_id = v_uid and pm.membership_status = 'ACTIVE';

  return jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'is_platform_super_admin', true,
    'workspaces', v_workspaces,
    'projects', v_projects
  );
end $$;

-- RPC: Catat Mutasi Inventaris
create or replace function public.record_inventory_mutation_scoped(
  p_workspace_id uuid,
  p_project_id uuid,
  p_idempotency_key uuid,
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_occurred_at timestamptz default now(),
  p_reference_no text default null,
  p_counterparty text default null,
  p_location text default null,
  p_notes text default null,
  p_source_name text default null,
  p_destination_name text default null,
  p_recipient_name text default null,
  p_owner_type text default 'KONTRAKTOR',
  p_purpose text default null,
  p_addition_id uuid default null
) returns public.inventory_transactions language plpgsql security definer set search_path = public as $$
declare
  v_item public.boq_items%rowtype;
  v_result public.inventory_transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Otorisasi diperlukan.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Jumlah kuantitas harus lebih dari nol.'; end if;

  select * into v_item from public.boq_items where id = p_item_id;
  if not found then raise exception 'Item BOQ tidak ditemukan.'; end if;

  select * into v_result from public.inventory_transactions where idempotency_key = p_idempotency_key;
  if found then return v_result; end if;

  insert into public.inventory_transactions (
    workspace_id, project_id, idempotency_key, item_id, transaction_type,
    quantity, uom, occurred_at, reference_no, counterparty, location, notes,
    source_name, destination_name, recipient_name, owner_type, purpose,
    addition_id, created_by, created_by_name
  ) values (
    p_workspace_id, p_project_id, p_idempotency_key, p_item_id, p_type,
    p_quantity, v_item.uom, coalesce(p_occurred_at, now()), p_reference_no,
    p_counterparty, p_location, p_notes, p_source_name, p_destination_name,
    p_recipient_name, p_owner_type, p_purpose, p_addition_id, auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), 'Petugas')
  ) returning * into v_result;

  insert into public.audit_logs (workspace_id, project_id, actor_id, action, entity_type, entity_id, details)
  values (p_workspace_id, p_project_id, auth.uid(), 'INVENTORY_MUTATION', 'inventory_transactions', v_result.id::text, jsonb_build_object('item', v_item.description, 'type', p_type, 'qty', p_quantity));

  return v_result;
end $$;

-- RPC: Pembalik Mutasi Inventaris
create or replace function public.reverse_inventory_transaction_scoped(
  p_workspace_id uuid,
  p_project_id uuid,
  p_transaction_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns public.inventory_transactions language plpgsql security definer set search_path = public as $$
declare
  v_orig public.inventory_transactions%rowtype;
  v_rev_type text;
  v_result public.inventory_transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Otorisasi diperlukan.'; end if;
  select * into v_orig from public.inventory_transactions where id = p_transaction_id;
  if not found then raise exception 'Transaksi asli tidak ditemukan.'; end if;

  v_rev_type := case
    when v_orig.transaction_type in ('MASUK', 'PENYESUAIAN_MASUK') then 'KELUAR'
    else 'MASUK'
  end;

  insert into public.inventory_transactions (
    workspace_id, project_id, idempotency_key, item_id, transaction_type,
    quantity, uom, occurred_at, reference_no, counterparty, location, notes,
    source_name, destination_name, recipient_name, owner_type, purpose, created_by
  ) values (
    p_workspace_id, p_project_id, p_idempotency_key, v_orig.item_id, v_rev_type,
    v_orig.quantity, v_orig.uom, now(), 'REVERSAL-' || coalesce(v_orig.reference_no, ''),
    'Koreksi', 'Koreksi sistem', 'Pembalikan transaksi: ' || p_reason,
    'Sistem', 'Sistem', 'Petugas Koreksi', v_orig.owner_type, p_reason, auth.uid()
  ) returning * into v_result;

  insert into public.inventory_transaction_reversals (
    workspace_id, project_id, original_transaction_id, reversal_transaction_id, reason, created_by
  ) values (
    p_workspace_id, p_project_id, p_transaction_id, v_result.id, p_reason, auth.uid()
  );

  return v_result;
end $$;

-- RPC: Catat Mutasi Kas
create or replace function public.record_cash_mutation_scoped(
  p_workspace_id uuid,
  p_project_id uuid,
  p_idempotency_key uuid,
  p_type text,
  p_amount numeric,
  p_occurred_at timestamptz default now(),
  p_category text default null,
  p_description text default null,
  p_reference_no text default null,
  p_pic text default null,
  p_notes text default null
) returns public.cash_transactions language plpgsql security definer set search_path = public as $$
declare
  v_result public.cash_transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Otorisasi diperlukan.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal kas harus lebih dari nol.'; end if;

  select * into v_result from public.cash_transactions where idempotency_key = p_idempotency_key;
  if found then return v_result; end if;

  insert into public.cash_transactions (
    workspace_id, project_id, idempotency_key, transaction_type,
    amount, occurred_at, category, description, reference_no, pic, notes, created_by
  ) values (
    p_workspace_id, p_project_id, p_idempotency_key, p_type,
    p_amount, coalesce(p_occurred_at, now()), p_category, coalesce(p_description, 'Transaksi Kas'),
    p_reference_no, p_pic, p_notes, auth.uid()
  ) returning * into v_result;

  insert into public.audit_logs (workspace_id, project_id, actor_id, action, entity_type, entity_id, details)
  values (p_workspace_id, p_project_id, auth.uid(), 'CASH_MUTATION', 'cash_transactions', v_result.id::text, jsonb_build_object('type', p_type, 'amount', p_amount));

  return v_result;
end $$;

-- RPC: Pembalik Mutasi Kas
create or replace function public.reverse_cash_transaction_scoped(
  p_workspace_id uuid,
  p_project_id uuid,
  p_transaction_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns public.cash_transactions language plpgsql security definer set search_path = public as $$
declare
  v_orig public.cash_transactions%rowtype;
  v_rev_type text;
  v_result public.cash_transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Otorisasi diperlukan.'; end if;
  select * into v_orig from public.cash_transactions where id = p_transaction_id;
  if not found then raise exception 'Transaksi kas asli tidak ditemukan.'; end if;

  v_rev_type := case when v_orig.transaction_type = 'MASUK' then 'KELUAR' else 'MASUK' end;

  insert into public.cash_transactions (
    workspace_id, project_id, idempotency_key, transaction_type,
    amount, occurred_at, category, description, reference_no, pic, notes, created_by
  ) values (
    p_workspace_id, p_project_id, p_idempotency_key, v_rev_type,
    v_orig.amount, now(), 'KOREKSI', 'Pembalikan kas: ' || p_reason,
    'REV-' || coalesce(v_orig.reference_no, ''), 'Sistem', p_reason, auth.uid()
  ) returning * into v_result;

  insert into public.cash_transaction_reversals (
    workspace_id, project_id, original_transaction_id, reversal_transaction_id, reason, created_by
  ) values (
    p_workspace_id, p_project_id, p_transaction_id, v_result.id, p_reason, auth.uid()
  );

  return v_result;
end $$;

-- ==============================================================================
-- 11. TRIGGER AUTH UNTUK PENGGUNA BARU
-- ==============================================================================
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Pengguna Baru'),
    'admin',
    true
  ) on conflict (id) do nothing;
  return new;
end $$;

-- Trigger dijalankan setelah registrasi/Google sign-in
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created_cair') then
    create trigger on_auth_user_created_cair
      after insert on auth.users
      for each row execute function public.handle_new_auth_user();
  end if;
end $$;

-- ==============================================================================
-- 12. KEAMANAN & ROW LEVEL SECURITY (RLS)
-- ==============================================================================
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.project_permission_catalog enable row level security;
alter table public.project_membership_permissions enable row level security;
alter table public.boq_sections enable row level security;
alter table public.boq_items enable row level security;
alter table public.boq_additions enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.inventory_transaction_reversals enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.cash_transaction_reversals enable row level security;
alter table public.documents enable row level security;
alter table public.audit_logs enable row level security;

-- Policy sederhana dan aman untuk pengguna terotentikasi
create policy profiles_authenticated on public.profiles for all to authenticated using(true) with check(true);
create policy workspaces_authenticated on public.workspaces for all to authenticated using(true) with check(true);
create policy companies_authenticated on public.companies for all to authenticated using(true) with check(true);
create policy company_memberships_authenticated on public.company_memberships for all to authenticated using(true) with check(true);
create policy projects_authenticated on public.projects for all to authenticated using(true) with check(true);
create policy project_memberships_authenticated on public.project_memberships for all to authenticated using(true) with check(true);
create policy project_permission_catalog_authenticated on public.project_permission_catalog for select to authenticated using(true);
create policy project_membership_permissions_authenticated on public.project_membership_permissions for all to authenticated using(true) with check(true);
create policy boq_sections_authenticated on public.boq_sections for all to authenticated using(true) with check(true);
create policy boq_items_authenticated on public.boq_items for all to authenticated using(true) with check(true);
create policy boq_additions_authenticated on public.boq_additions for all to authenticated using(true) with check(true);
create policy inventory_transactions_authenticated on public.inventory_transactions for all to authenticated using(true) with check(true);
create policy inventory_transaction_reversals_authenticated on public.inventory_transaction_reversals for all to authenticated using(true) with check(true);
create policy cash_transactions_authenticated on public.cash_transactions for all to authenticated using(true) with check(true);
create policy cash_transaction_reversals_authenticated on public.cash_transaction_reversals for all to authenticated using(true) with check(true);
create policy documents_authenticated on public.documents for all to authenticated using(true) with check(true);
create policy audit_logs_authenticated on public.audit_logs for all to authenticated using(true) with check(true);

-- Berikan izin akses penuh ke authenticated
grant all on public.profiles, public.workspaces, public.companies, public.company_memberships,
  public.projects, public.project_memberships, public.project_permission_catalog,
  public.project_membership_permissions, public.boq_sections, public.boq_items,
  public.boq_additions, public.inventory_transactions, public.inventory_transaction_reversals,
  public.cash_transactions, public.cash_transaction_reversals, public.documents,
  public.audit_logs to authenticated;

grant execute on function public.resolve_my_active_context() to authenticated;
grant execute on function public.record_inventory_mutation_scoped(uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.reverse_inventory_transaction_scoped(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.record_cash_mutation_scoped(uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text) to authenticated;
grant execute on function public.reverse_cash_transaction_scoped(uuid,uuid,uuid,text,uuid) to authenticated;

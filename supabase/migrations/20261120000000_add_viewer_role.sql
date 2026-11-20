-- Migration: Menambahkan Persona/Jabatan ke-7 "VIEWER" (Viewer / Pengamat)
-- Hak Akses: Murni Read-Only (Pengamat Transparansi, Konsultan, Auditor, Pendana, Pengawas Klien IMK)

-- 1. Tambah ke role_catalog
INSERT INTO public.role_catalog (role_code, display_name, description, sort_order, active)
VALUES (
  'VIEWER',
  'Viewer / Pengamat',
  'Akses pantau read-only: dasbor analitik, rekapitulasi, buku mutasi barang & kas, dan ekspor PDF.',
  70,
  true
)
ON CONFLICT (role_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active;

-- 2. Hak Akses di role_permission_catalog (Hanya Read, Tanpa Write/Approval)
INSERT INTO public.role_permission_catalog (role_code, permission_code, active)
VALUES
  ('VIEWER', 'STOCK_READ', true),
  ('VIEWER', 'CASH_READ', true),
  ('VIEWER', 'REPORT_READ', true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET
  active = true;

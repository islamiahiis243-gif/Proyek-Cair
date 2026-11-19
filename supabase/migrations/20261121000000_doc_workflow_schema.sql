-- ============================================================
-- Skema Alur Dokumen Tahap 5: Batal, Ganti, & Persetujuan Berseri
-- ============================================================

-- 1. Tambah kolom pada inventory_transactions
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS status_dokumen text NOT NULL DEFAULT 'DITERBITKAN',
  ADD COLUMN IF NOT EXISTS diperiksa_oleh text,
  ADD COLUMN IF NOT EXISTS disetujui_oleh text,
  ADD COLUMN IF NOT EXISTS mengetahui_oleh text,
  ADD COLUMN IF NOT EXISTS tte_qr_code text,
  ADD COLUMN IF NOT EXISTS is_batal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_ganti boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alasan_batal_ganti text;

-- 2. Tambah kolom pada cash_transactions
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS status_dokumen text NOT NULL DEFAULT 'DITERBITKAN',
  ADD COLUMN IF NOT EXISTS diperiksa_oleh text,
  ADD COLUMN IF NOT EXISTS disetujui_oleh text,
  ADD COLUMN IF NOT EXISTS mengetahui_oleh text,
  ADD COLUMN IF NOT EXISTS tte_qr_code text,
  ADD COLUMN IF NOT EXISTS is_batal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_ganti boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alasan_batal_ganti text;

-- 3. Kebijakan RLS agar anggota yang memiliki akses proyek dapat memperbarui status workflow dokumen
CREATE POLICY "authenticated_update_inventory_workflow" ON public.inventory_transactions
  FOR UPDATE USING (
    auth.uid() IS NOT NULL
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

CREATE POLICY "authenticated_update_cash_workflow" ON public.cash_transactions
  FOR UPDATE USING (
    auth.uid() IS NOT NULL
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

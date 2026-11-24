-- ============================================================================
-- Migrasi Paritas Modul Mutasi Dana (Cashflow) & Integrasi Lintas Modul
-- Tanggal: 2026-11-24
-- Rujukan: docs/PANDUAN_ENGINE_DINAMIS_MUTASI_DANA_DAN_REKONSILIASI.md (Revisi 3)
-- ============================================================================

-- 1. Tambah kolom scope di project_receipts agar dapat dipakai bersama Barang & Kas
ALTER TABLE public.project_receipts
  ADD COLUMN IF NOT EXISTS receipt_scope text NOT NULL DEFAULT 'BELANJA_BARANG';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_receipts_receipt_scope_check'
  ) THEN
    ALTER TABLE public.project_receipts
      ADD CONSTRAINT project_receipts_receipt_scope_check
      CHECK (receipt_scope IN ('BELANJA_BARANG', 'KAS_OPERASIONAL', 'TERPADU'));
  END IF;
END $$;

-- 2. Lengkapi kolom operasional, bukti nota, relasi BOQ, panjar, & Unified Module Link pada cash_transactions
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'TUNAI',
  ADD COLUMN IF NOT EXISTS beban_biaya text NOT NULL DEFAULT 'KONTRAKTOR',
  ADD COLUMN IF NOT EXISTS status_bukti text NOT NULL DEFAULT 'TANPA_BUKTI',
  ADD COLUMN IF NOT EXISTS nama_toko text,
  ADD COLUMN IF NOT EXISTS toko_kontak text,
  ADD COLUMN IF NOT EXISTS tanggal_nota timestamptz,
  ADD COLUMN IF NOT EXISTS total_nota_fisik numeric(18,2),
  ADD COLUMN IF NOT EXISTS lampiran_nota_urls text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.project_receipts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boq_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_kasbon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_kasbon text NOT NULL DEFAULT 'TIDAK_BERLAKU',
  ADD COLUMN IF NOT EXISTS kasbon_induk_id uuid REFERENCES public.cash_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nominal_lpj numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lpj_kategori_riil text,
  ADD COLUMN IF NOT EXISTS source_module text NOT NULL DEFAULT 'KAS_LANGSUNG',
  ADD COLUMN IF NOT EXISTS source_entity_id uuid,
  ADD COLUMN IF NOT EXISTS source_entity_no text;

-- 3. Validasi constraint domain yang ketat
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_payment_method_check'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_payment_method_check
      CHECK (payment_method IN ('TUNAI', 'TRANSFER', 'GIRO_CEK', 'DOMPET_DIGITAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_beban_biaya_check'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_beban_biaya_check
      CHECK (beban_biaya IN ('PROYEK_BOQ', 'OPERASIONAL', 'KLIEN', 'BONUS_KLIEN', 'KONTRAKTOR'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_status_bukti_check'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_status_bukti_check
      CHECK (status_bukti IN ('TERLAMPIR', 'BUKTI_MENYUSUL', 'TANPA_BUKTI', 'REKONSILIASI_NOTA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_status_kasbon_check'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_status_kasbon_check
      CHECK (status_kasbon IN ('TIDAK_BERLAKU', 'TERBUKA', 'SEBAGIAN', 'LUNAS'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_source_module_check'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_source_module_check
      CHECK (source_module IN ('KAS_LANGSUNG', 'MUTASI_BARANG', 'PO_PENGADAAN', 'UPAH_MANDOR', 'TERMIN_BAP', 'SUBKON_ALAT'));
  END IF;
END $$;

-- 4. Kolom privasi POV pada tabel documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS audience_pov text NOT NULL DEFAULT 'KONTRAKTOR';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_audience_pov_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_audience_pov_check
      CHECK (audience_pov IN ('KONTRAKTOR', 'KLIEN', 'UMUM'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_project_audience_pov
  ON public.documents (project_id, audience_pov);

-- 5. Indeks performa query proyek & Foreign Keys (parsial agar hemat ruang)
CREATE INDEX IF NOT EXISTS idx_cash_transactions_project_occurred
  ON public.cash_transactions (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_receipt_id
  ON public.cash_transactions (receipt_id)
  WHERE receipt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_transactions_boq_item_id
  ON public.cash_transactions (boq_item_id)
  WHERE boq_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_transactions_kasbon_open
  ON public.cash_transactions (project_id, status_kasbon)
  WHERE is_kasbon = true AND is_batal = false AND is_ganti = false;

CREATE INDEX IF NOT EXISTS idx_cash_transactions_kasbon_induk_id
  ON public.cash_transactions (kasbon_induk_id)
  WHERE kasbon_induk_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_transactions_source_module
  ON public.cash_transactions (project_id, source_module, source_entity_id)
  WHERE source_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_receipts_project_created
  ON public.project_receipts (project_id, created_at DESC);

-- 6. Backfill aman dokumen MUTASI_STOK lama (pra-migrasi) ke audience_pov = 'UMUM'
-- agar Pengamat/Klien tetap dapat memverifikasi Berita Acara fisik gudang lama
UPDATE public.documents
SET audience_pov = 'UMUM'
WHERE document_type = 'MUTASI_STOK'
  AND audience_pov = 'KONTRAKTOR'
  AND (snapshot IS NULL OR snapshot->>'audience_pov' IS NULL);

-- 7. Hak akses (GRANT) & kebijakan RLS berbasis proyek untuk project_receipts, supplier_stores, dan Storage upsert
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_receipts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_stores TO authenticated, service_role;

ALTER TABLE public.project_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Access project_receipts" ON public.project_receipts;
DROP POLICY IF EXISTS "project_receipts_scoped_access" ON public.project_receipts;
CREATE POLICY "project_receipts_scoped_access" ON public.project_receipts
  FOR ALL TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())))
  WITH CHECK (public.check_user_project_access(project_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "supplier_stores_scoped_access" ON public.supplier_stores;
CREATE POLICY "supplier_stores_scoped_access" ON public.supplier_stores
  FOR ALL TO authenticated
  USING (project_id IS NULL OR public.check_user_project_access(project_id, (SELECT auth.uid())))
  WITH CHECK (project_id IS NULL OR public.check_user_project_access(project_id, (SELECT auth.uid())));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow Update Receipts'
  ) THEN
    CREATE POLICY "Allow Update Receipts" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'receipts')
      WITH CHECK (bucket_id = 'receipts');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

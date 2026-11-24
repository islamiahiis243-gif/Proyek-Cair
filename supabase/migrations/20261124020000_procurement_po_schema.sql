-- ============================================================================
-- Migrasi Tahap 2: Modul Pengadaan Material & Surat Pesanan (PO Toko)
-- Tanggal: 2026-11-24
-- Rujukan: docs/PANDUAN_ENGINE_DINAMIS_PENGADAAN_PO_TOKO.md
-- ============================================================================

-- 1. Perluasan direktori toko rekanan (supplier_stores)
ALTER TABLE public.supplier_stores
  ADD COLUMN IF NOT EXISTS pic_toko text,
  ADD COLUMN IF NOT EXISTS syarat_bayar_default text NOT NULL DEFAULT 'TUNAI_SAAT_TIBA',
  ADD COLUMN IF NOT EXISTS catatan text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_stores_syarat_bayar_default_check'
  ) THEN
    ALTER TABLE public.supplier_stores
      ADD CONSTRAINT supplier_stores_syarat_bayar_default_check
      CHECK (syarat_bayar_default IN ('TUNAI_SAAT_TIBA', 'DP_PELUNASAN', 'TEMPO_7', 'TEMPO_14', 'TEMPO_30'));
  END IF;
END $$;

-- 2. Tabel header Surat Pesanan (purchase_orders)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  po_no text NOT NULL UNIQUE,
  store_id uuid REFERENCES public.supplier_stores(id) ON DELETE SET NULL,
  nama_toko text NOT NULL,
  toko_kontak text,
  tanggal_po timestamptz NOT NULL DEFAULT now(),
  estimasi_tiba date,
  payment_terms text NOT NULL DEFAULT 'TUNAI_SAAT_TIBA',
  jatuh_tempo_bayar date,
  dp_amount_rp numeric(18,2) NOT NULL DEFAULT 0 CHECK (dp_amount_rp >= 0),
  total_amount_rp numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_amount_rp >= 0),
  catatan_toko text,
  sent_to_store_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_by_name text,
  status_dokumen text NOT NULL DEFAULT 'DITERBITKAN',
  diperiksa_oleh text,
  disetujui_oleh text,
  mengetahui_oleh text,
  tte_qr_code text,
  is_batal boolean NOT NULL DEFAULT false,
  is_ganti boolean NOT NULL DEFAULT false,
  referensi_ganti_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  alasan_batal_ganti text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_payment_terms_check
    CHECK (payment_terms IN ('TUNAI_SAAT_TIBA', 'DP_PELUNASAN', 'TEMPO_7', 'TEMPO_14', 'TEMPO_30')),
  CONSTRAINT purchase_orders_status_dokumen_check
    CHECK (status_dokumen IN ('DITERBITKAN', 'DIPERIKSA', 'DISETUJUI', 'MENGETAHUI', 'BATAL', 'DIGANTI'))
);

-- 3. Tabel baris item Surat Pesanan (purchase_order_items)
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  boq_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
  nama_barang text NOT NULL,
  satuan text NOT NULL DEFAULT 'Unit',
  qty_pesan numeric(18,4) NOT NULL CHECK (qty_pesan > 0),
  harga_satuan_po numeric(18,2) NOT NULL DEFAULT 0 CHECK (harga_satuan_po >= 0),
  harga_pagu_boq numeric(18,2) NOT NULL DEFAULT 0 CHECK (harga_pagu_boq >= 0),
  subtotal_rp numeric(18,2) NOT NULL DEFAULT 0 CHECK (subtotal_rp >= 0),
  catatan text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Tautan 2 arah pada inventory_transactions
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

-- 5. Indeks performa & covering indexes untuk Foreign Keys
CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_date
  ON public.purchase_orders (project_id, tanggal_po DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_workspace_id
  ON public.purchase_orders (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_id
  ON public.purchase_orders (store_id)
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by
  ON public.purchase_orders (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_referensi_ganti_id
  ON public.purchase_orders (referensi_ganti_id)
  WHERE referensi_ganti_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id
  ON public.purchase_order_items (po_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_project_id
  ON public.purchase_order_items (project_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_boq_item_id
  ON public.purchase_order_items (boq_item_id)
  WHERE boq_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_po_id
  ON public.inventory_transactions (po_id)
  WHERE po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_po_item_id
  ON public.inventory_transactions (po_item_id)
  WHERE po_item_id IS NOT NULL;

-- 6. Hak akses & RLS sisi server ketat (hanya akses finansial kontraktor / non-Viewer)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated, service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_orders_financial_access" ON public.purchase_orders;
CREATE POLICY "purchase_orders_financial_access" ON public.purchase_orders
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

DROP POLICY IF EXISTS "purchase_order_items_financial_access" ON public.purchase_order_items;
CREATE POLICY "purchase_order_items_financial_access" ON public.purchase_order_items
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

NOTIFY pgrst, 'reload schema';

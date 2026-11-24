-- ============================================================================
-- Pengerasan Keamanan Produksi: RLS Berlapis Sisi Server (Viewer/Pengamat)
-- & Pembatasan Policy Storage Bucket 'receipts' ke Peran authenticated
-- Tanggal: 2026-11-24
-- ============================================================================

-- 1. Skema privat non-ekspos & helper pengecekan akses finansial proyek
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.check_user_project_financial_access(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_has_access boolean := false;
BEGIN
  IF v_uid IS NULL OR p_project_id IS NULL THEN
    RETURN false;
  END IF;

  -- A. Anggota proyek aktif non-Viewer dengan izin finansial aktif
  SELECT EXISTS (
    SELECT 1
    FROM public.project_memberships pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = v_uid
      AND pm.membership_status = 'ACTIVE'
      AND UPPER(COALESCE(pm.role_code, '')) NOT IN ('VIEWER', 'PENGAMAT', 'OBSERVER')
      AND COALESCE(pm.can_view_financials, true) = true
  ) INTO v_has_access;

  IF v_has_access THEN
    RETURN true;
  END IF;

  -- B. Pemegang kursi CSA sah dari perusahaan pemilik proyek
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.workspaces w ON w.id = p.workspace_id
    JOIN public.company_admin_seats cas ON cas.company_id = w.company_id
    WHERE p.id = p_project_id
      AND cas.claimed_by = v_uid
      AND cas.seat_status = 'CLAIMED'
  ) INTO v_has_access;

  IF v_has_access THEN
    RETURN true;
  END IF;

  -- C. Company Super Admin aktif di company_memberships
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.workspaces w ON w.id = p.workspace_id
    JOIN public.company_memberships cm ON cm.workspace_id = w.id
    WHERE p.id = p_project_id
      AND cm.user_id = v_uid
      AND cm.is_company_super_admin = true
      AND cm.membership_status = 'ACTIVE'
  ) INTO v_has_access;

  RETURN v_has_access;
END;
$$;

REVOKE ALL ON FUNCTION private.check_user_project_financial_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_user_project_financial_access(uuid) TO authenticated, service_role;

-- Indeks bantu lookup RLS pada project_memberships
CREATE INDEX IF NOT EXISTS idx_project_memberships_rls_lookup
  ON public.project_memberships (project_id, user_id, membership_status);

-- 2. Pengerasan RLS public.cash_transactions
-- Viewer/Pengamat (dan user tanpa akses finansial) diblokir total dari SELECT/INSERT/UPDATE/DELETE
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_transactions_scoped_access" ON public.cash_transactions;
DROP POLICY IF EXISTS "cash_transactions_financial_access" ON public.cash_transactions;

CREATE POLICY "cash_transactions_financial_access" ON public.cash_transactions
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

-- 3. Pengerasan RLS public.documents berdasarkan audience_pov & document_type
-- Viewer/Pengamat hanya boleh SELECT dokumen KLIEN/UMUM (bukan MUTASI_KAS), tanpa hak tulis
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_scoped_access" ON public.documents;
DROP POLICY IF EXISTS "documents_select_pov_scoped" ON public.documents;
DROP POLICY IF EXISTS "documents_insert_financial" ON public.documents;
DROP POLICY IF EXISTS "documents_update_financial" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_financial" ON public.documents;

CREATE POLICY "documents_select_pov_scoped" ON public.documents
  FOR SELECT TO authenticated
  USING (
    (SELECT private.check_user_project_financial_access(project_id))
    OR (
      public.check_user_project_access(project_id, (SELECT auth.uid()))
      AND audience_pov IN ('KLIEN', 'UMUM')
      AND document_type <> 'MUTASI_KAS'
    )
  );

CREATE POLICY "documents_insert_financial" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

CREATE POLICY "documents_update_financial" ON public.documents
  FOR UPDATE TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

CREATE POLICY "documents_delete_financial" ON public.documents
  FOR DELETE TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)));

-- 4. Pengerasan RLS public.project_receipts berdasarkan receipt_scope
-- Viewer/Pengamat hanya boleh SELECT nota barang/terpadu (bukan KAS_OPERASIONAL), tanpa hak tulis
ALTER TABLE public.project_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_receipts_scoped_access" ON public.project_receipts;
DROP POLICY IF EXISTS "project_receipts_select_pov_scoped" ON public.project_receipts;
DROP POLICY IF EXISTS "project_receipts_insert_financial" ON public.project_receipts;
DROP POLICY IF EXISTS "project_receipts_update_financial" ON public.project_receipts;
DROP POLICY IF EXISTS "project_receipts_delete_financial" ON public.project_receipts;

CREATE POLICY "project_receipts_select_pov_scoped" ON public.project_receipts
  FOR SELECT TO authenticated
  USING (
    (SELECT private.check_user_project_financial_access(project_id))
    OR (
      public.check_user_project_access(project_id, (SELECT auth.uid()))
      AND receipt_scope <> 'KAS_OPERASIONAL'
    )
  );

CREATE POLICY "project_receipts_insert_financial" ON public.project_receipts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

CREATE POLICY "project_receipts_update_financial" ON public.project_receipts
  FOR UPDATE TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

CREATE POLICY "project_receipts_delete_financial" ON public.project_receipts
  FOR DELETE TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)));

-- 5. Pembatasan policy storage.objects bucket 'receipts' (INSERT & DELETE khusus authenticated)
-- Policy SELECT "Public Access Receipts" dipertahankan agar URL publik gambar nota tetap tampil
DROP POLICY IF EXISTS "Allow Upload Receipts" ON storage.objects;
CREATE POLICY "Allow Upload Receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');

DROP POLICY IF EXISTS "Allow Delete Receipts" ON storage.objects;
CREATE POLICY "Allow Delete Receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts');

NOTIFY pgrst, 'reload schema';

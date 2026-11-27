-- =========================================================================
-- MIGRASI PENGERASAN KEAMANAN, RLS MULTI-TENANT, STORAGE PRIVAT & SKEMA
-- =========================================================================

-- 1. HAPUS RPC PENINGGALAN UJI COBA YANG BERBAHAYA (ANON REMOTE WIPE)
DROP FUNCTION IF EXISTS public.reset_all_uploaded_receipts();

-- 2. CABUT HAK EKSEKUSI ANON PADA SELURUH FUNGSI SECURITY DEFINER DI PUBLIC
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon;', fn.sig);
    IF fn.proname IN ('handle_new_auth_user', 'rls_auto_enable') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated;', fn.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated;', fn.sig);
    END IF;
  END LOOP;
END $$;

-- 3. HELPER PRIVATE SCHEMA (STABLE SECURITY DEFINER, BEBAS REKURSI & BEBAS DATA API)
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_platform_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'PLATFORM_SUPER_ADMIN'
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION private.get_my_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.get_my_profile_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT is_active FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.is_company_admin_for_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_company_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      private.is_platform_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.company_memberships cm
        WHERE cm.company_id = p_company_id
          AND cm.user_id = (SELECT auth.uid())
          AND cm.membership_status = 'ACTIVE'
          AND cm.is_company_super_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM public.company_admin_seats cas
        WHERE cas.company_id = p_company_id
          AND cas.claimed_by = (SELECT auth.uid())
          AND cas.seat_status = 'CLAIMED'
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.is_company_admin_for_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_workspace_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      private.is_platform_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.workspaces w
        WHERE w.id = p_workspace_id
          AND w.company_id IS NOT NULL
          AND private.is_company_admin_for_company(w.company_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.company_memberships cm
        WHERE cm.workspace_id = p_workspace_id
          AND cm.user_id = (SELECT auth.uid())
          AND cm.membership_status = 'ACTIVE'
          AND cm.is_company_super_admin = true
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.check_user_workspace_read_access(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_workspace_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      private.is_platform_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.workspaces w
        WHERE w.id = p_workspace_id AND w.owner_user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.company_memberships cm
        WHERE cm.workspace_id = p_workspace_id
          AND cm.user_id = (SELECT auth.uid())
          AND cm.membership_status = 'ACTIVE'
      )
      OR EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.workspace_id = p_workspace_id
          AND pm.user_id = (SELECT auth.uid())
          AND pm.membership_status = 'ACTIVE'
      )
      OR private.is_company_admin_for_workspace(p_workspace_id)
    );
$$;

CREATE OR REPLACE FUNCTION private.check_user_project_write_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_project_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.project_id = p_project_id
          AND pm.user_id = (SELECT auth.uid())
          AND pm.membership_status = 'ACTIVE'
          AND UPPER(COALESCE(pm.role_code, '')) NOT IN ('VIEWER', 'PENGAMAT', 'OBSERVER')
      )
      OR EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = p_project_id
          AND private.is_company_admin_for_workspace(p.workspace_id)
      )
    );
$$;

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

CREATE OR REPLACE FUNCTION private.can_view_profile(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (
      p_target_user_id = (SELECT auth.uid())
      OR private.is_platform_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships cm1
        JOIN public.company_memberships cm2 ON cm1.company_id = cm2.company_id
        WHERE cm1.user_id = (SELECT auth.uid()) AND cm1.membership_status = 'ACTIVE'
          AND cm2.user_id = p_target_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_memberships pm1
        JOIN public.project_memberships pm2 ON pm1.project_id = pm2.project_id
        WHERE pm1.user_id = (SELECT auth.uid()) AND pm1.membership_status = 'ACTIVE'
          AND pm2.user_id = p_target_user_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.check_user_storage_receipt_access(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_project_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_prefix := split_part(p_object_name, '/', 1);
  IF v_prefix IS NULL OR v_prefix = '' THEN
    RETURN false;
  END IF;

  SELECT p.id INTO v_project_id
  FROM public.projects p
  WHERE p.id::text = v_prefix OR p.project_code = v_prefix
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN private.check_user_project_financial_access(v_project_id);
END;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- 4. PERBAIKI CONSTRAINT & BERSIHKAN DATA ILEGAL PRODUKSI
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_owner_type_check;
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_owner_type_check
  CHECK (owner_type IN ('KONTRAKTOR', 'IMK', 'KLIEN'));

-- Bersihkan 18 baris produksi yang sebelumnya tercemar status_harga = 'ADA_HARGA'
UPDATE public.inventory_transactions
SET status_harga = 'TERCATAT'
WHERE status_harga = 'ADA_HARGA';

-- 5. PERKERAS RLS PADA SELURUH TABEL YANG SEBELUMNYA TERBUKA (USING true / ANON / VIEWER WRITE)

-- 5.1 profiles (tutup anon select & blokir eskalasi diri ke PLATFORM_SUPER_ADMIN)
DROP POLICY IF EXISTS profiles_anon_select ON public.profiles;
DROP POLICY IF EXISTS profiles_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_select_scoped ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_select_scoped ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.can_view_profile(id)));
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()) AND role <> 'PLATFORM_SUPER_ADMIN');
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_platform_super_admin()))
  WITH CHECK (
    (SELECT private.is_platform_super_admin())
    OR (
      id = (SELECT auth.uid())
      AND role = (SELECT private.get_my_profile_role())
      AND is_active = (SELECT private.get_my_profile_is_active())
    )
  );

-- 5.2 workspace_context_audit (tutup akses anon sepenuhnya)
DROP POLICY IF EXISTS workspace_context_audit_anon ON public.workspace_context_audit;
DROP POLICY IF EXISTS workspace_context_audit_authenticated ON public.workspace_context_audit;
DROP POLICY IF EXISTS wca_select_scoped ON public.workspace_context_audit;
DROP POLICY IF EXISTS wca_insert_own ON public.workspace_context_audit;
CREATE POLICY wca_select_scoped ON public.workspace_context_audit
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_platform_super_admin()));
CREATE POLICY wca_insert_own ON public.workspace_context_audit
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 5.3 companies
DROP POLICY IF EXISTS companies_authenticated ON public.companies;
DROP POLICY IF EXISTS companies_select_scoped ON public.companies;
DROP POLICY IF EXISTS companies_update_admin ON public.companies;
DROP POLICY IF EXISTS companies_insert_psa ON public.companies;
CREATE POLICY companies_select_scoped ON public.companies
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR (SELECT private.is_company_admin_for_company(id))
    OR EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = (SELECT auth.uid())
        AND cm.membership_status = 'ACTIVE'
    )
    OR EXISTS (
      SELECT 1 FROM public.workspaces w
      JOIN public.project_memberships pm ON pm.workspace_id = w.id
      WHERE w.company_id = companies.id
        AND pm.user_id = (SELECT auth.uid())
        AND pm.membership_status = 'ACTIVE'
    )
  );
CREATE POLICY companies_update_admin ON public.companies
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_company_admin_for_company(id)))
  WITH CHECK ((SELECT private.is_company_admin_for_company(id)));
CREATE POLICY companies_insert_psa ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_platform_super_admin()));

-- 5.4 workspaces
DROP POLICY IF EXISTS workspaces_authenticated ON public.workspaces;
DROP POLICY IF EXISTS workspaces_select_scoped ON public.workspaces;
DROP POLICY IF EXISTS workspaces_modify_scoped ON public.workspaces;
CREATE POLICY workspaces_select_scoped ON public.workspaces
  FOR SELECT TO authenticated
  USING ((SELECT private.check_user_workspace_read_access(id)));
CREATE POLICY workspaces_modify_scoped ON public.workspaces
  FOR ALL TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    OR (SELECT private.is_company_admin_for_workspace(id))
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    OR (SELECT private.is_company_admin_for_workspace(id))
  );

-- 5.5 projects
DROP POLICY IF EXISTS projects_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_select_scoped ON public.projects;
DROP POLICY IF EXISTS projects_modify_admin ON public.projects;
CREATE POLICY projects_select_scoped ON public.projects
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR public.check_user_project_access(id, (SELECT auth.uid()))
    OR (SELECT private.is_company_admin_for_workspace(workspace_id))
  );
CREATE POLICY projects_modify_admin ON public.projects
  FOR ALL TO authenticated
  USING ((SELECT private.is_company_admin_for_workspace(workspace_id)))
  WITH CHECK ((SELECT private.is_company_admin_for_workspace(workspace_id)));

-- 5.6 project_client_relationships
DROP POLICY IF EXISTS pcr_authenticated ON public.project_client_relationships;
DROP POLICY IF EXISTS pcr_select_scoped ON public.project_client_relationships;
DROP POLICY IF EXISTS pcr_modify_admin ON public.project_client_relationships;
CREATE POLICY pcr_select_scoped ON public.project_client_relationships
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR public.check_user_project_access(project_id, (SELECT auth.uid()))
  );
CREATE POLICY pcr_modify_admin ON public.project_client_relationships
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_client_relationships.project_id
        AND (SELECT private.is_company_admin_for_workspace(p.workspace_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_client_relationships.project_id
        AND (SELECT private.is_company_admin_for_workspace(p.workspace_id))
    )
  );

-- 5.7 company_memberships
DROP POLICY IF EXISTS company_memberships_authenticated ON public.company_memberships;
DROP POLICY IF EXISTS cm_select_scoped ON public.company_memberships;
DROP POLICY IF EXISTS cm_modify_admin ON public.company_memberships;
CREATE POLICY cm_select_scoped ON public.company_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT private.is_company_admin_for_company(company_id))
  );
CREATE POLICY cm_modify_admin ON public.company_memberships
  FOR ALL TO authenticated
  USING ((SELECT private.is_company_admin_for_company(company_id)))
  WITH CHECK ((SELECT private.is_company_admin_for_company(company_id)));

-- 5.8 project_memberships
DROP POLICY IF EXISTS project_memberships_authenticated ON public.project_memberships;
DROP POLICY IF EXISTS pm_select_scoped ON public.project_memberships;
DROP POLICY IF EXISTS pm_modify_admin ON public.project_memberships;
CREATE POLICY pm_select_scoped ON public.project_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.check_user_project_access(project_id, (SELECT auth.uid()))
    OR (SELECT private.is_company_admin_for_workspace(workspace_id))
  );
CREATE POLICY pm_modify_admin ON public.project_memberships
  FOR ALL TO authenticated
  USING ((SELECT private.is_company_admin_for_workspace(workspace_id)))
  WITH CHECK ((SELECT private.is_company_admin_for_workspace(workspace_id)));

-- 5.9 project_membership_permissions
DROP POLICY IF EXISTS project_membership_permissions_authenticated ON public.project_membership_permissions;
DROP POLICY IF EXISTS pmp_select_scoped ON public.project_membership_permissions;
DROP POLICY IF EXISTS pmp_modify_admin ON public.project_membership_permissions;
CREATE POLICY pmp_select_scoped ON public.project_membership_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_memberships pm
      WHERE pm.id = project_membership_permissions.project_membership_id
        AND (
          pm.user_id = (SELECT auth.uid())
          OR (SELECT private.is_company_admin_for_workspace(pm.workspace_id))
        )
    )
  );
CREATE POLICY pmp_modify_admin ON public.project_membership_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_memberships pm
      WHERE pm.id = project_membership_permissions.project_membership_id
        AND (SELECT private.is_company_admin_for_workspace(pm.workspace_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_memberships pm
      WHERE pm.id = project_membership_permissions.project_membership_id
        AND (SELECT private.is_company_admin_for_workspace(pm.workspace_id))
    )
  );

-- 5.10 company_member_access_assignments
DROP POLICY IF EXISTS cmaa_authenticated ON public.company_member_access_assignments;
DROP POLICY IF EXISTS cmaa_select_scoped ON public.company_member_access_assignments;
DROP POLICY IF EXISTS cmaa_modify_admin ON public.company_member_access_assignments;
CREATE POLICY cmaa_select_scoped ON public.company_member_access_assignments
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_company_admin_for_workspace(workspace_id))
    OR EXISTS (
      SELECT 1 FROM public.company_memberships cm
      WHERE cm.id = company_member_access_assignments.company_membership_id
        AND cm.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY cmaa_modify_admin ON public.company_member_access_assignments
  FOR ALL TO authenticated
  USING ((SELECT private.is_company_admin_for_workspace(workspace_id)))
  WITH CHECK ((SELECT private.is_company_admin_for_workspace(workspace_id)));

-- 5.11 audit_logs
DROP POLICY IF EXISTS audit_logs_authenticated ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_select_scoped ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_auth ON public.audit_logs;
CREATE POLICY audit_logs_select_scoped ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR actor_id = (SELECT auth.uid())
    OR (workspace_id IS NOT NULL AND (SELECT private.is_company_admin_for_workspace(workspace_id)))
  );
CREATE POLICY audit_logs_insert_auth ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = (SELECT auth.uid()) OR actor_id IS NULL);

-- 5.12 boq_additions, inventory_transaction_reversals, cash_transaction_reversals, authority_catalog
DROP POLICY IF EXISTS boq_additions_authenticated ON public.boq_additions;
DROP POLICY IF EXISTS boq_additions_select_scoped ON public.boq_additions;
DROP POLICY IF EXISTS boq_additions_write_scoped ON public.boq_additions;
CREATE POLICY boq_additions_select_scoped ON public.boq_additions
  FOR SELECT TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())));
CREATE POLICY boq_additions_write_scoped ON public.boq_additions
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_write_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_write_access(project_id)));

DROP POLICY IF EXISTS inventory_transaction_reversals_authenticated ON public.inventory_transaction_reversals;
DROP POLICY IF EXISTS inv_rev_select_scoped ON public.inventory_transaction_reversals;
DROP POLICY IF EXISTS inv_rev_write_scoped ON public.inventory_transaction_reversals;
CREATE POLICY inv_rev_select_scoped ON public.inventory_transaction_reversals
  FOR SELECT TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())));
CREATE POLICY inv_rev_write_scoped ON public.inventory_transaction_reversals
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_write_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_write_access(project_id)));

DROP POLICY IF EXISTS cash_transaction_reversals_authenticated ON public.cash_transaction_reversals;
DROP POLICY IF EXISTS cash_rev_financial ON public.cash_transaction_reversals;
CREATE POLICY cash_rev_financial ON public.cash_transaction_reversals
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_financial_access(project_id)));

DROP POLICY IF EXISTS ac_authenticated ON public.authority_catalog;
DROP POLICY IF EXISTS ac_select_auth ON public.authority_catalog;
DROP POLICY IF EXISTS ac_write_psa ON public.authority_catalog;
CREATE POLICY ac_select_auth ON public.authority_catalog
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ac_write_psa ON public.authority_catalog
  FOR ALL TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

-- 5.13 Pisahkan SELECT vs WRITE pada boq_sections, boq_items, inventory_transactions (Blokir Viewer Write!)
DROP POLICY IF EXISTS boq_sections_project_scoped_access ON public.boq_sections;
DROP POLICY IF EXISTS boq_sections_select_scoped ON public.boq_sections;
DROP POLICY IF EXISTS boq_sections_write_scoped ON public.boq_sections;
CREATE POLICY boq_sections_select_scoped ON public.boq_sections
  FOR SELECT TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())));
CREATE POLICY boq_sections_write_scoped ON public.boq_sections
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_write_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_write_access(project_id)));

DROP POLICY IF EXISTS boq_items_project_scoped_access ON public.boq_items;
DROP POLICY IF EXISTS boq_items_select_scoped ON public.boq_items;
DROP POLICY IF EXISTS boq_items_write_scoped ON public.boq_items;
CREATE POLICY boq_items_select_scoped ON public.boq_items
  FOR SELECT TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())));
CREATE POLICY boq_items_write_scoped ON public.boq_items
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_write_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_write_access(project_id)));

DROP POLICY IF EXISTS inventory_transactions_scoped_access ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_select_scoped ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_write_scoped ON public.inventory_transactions;
CREATE POLICY inventory_transactions_select_scoped ON public.inventory_transactions
  FOR SELECT TO authenticated
  USING (public.check_user_project_access(project_id, (SELECT auth.uid())));
CREATE POLICY inventory_transactions_write_scoped ON public.inventory_transactions
  FOR ALL TO authenticated
  USING ((SELECT private.check_user_project_write_access(project_id)))
  WITH CHECK ((SELECT private.check_user_project_write_access(project_id)));

-- 5.14 supplier_stores, project_receipts, documents (Tutup kebocoran ke Viewer & lintas tenant)
DROP POLICY IF EXISTS supplier_stores_scoped_access ON public.supplier_stores;
DROP POLICY IF EXISTS supplier_stores_financial_access ON public.supplier_stores;
CREATE POLICY supplier_stores_financial_access ON public.supplier_stores
  FOR ALL TO authenticated
  USING (project_id IS NULL OR (SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK (project_id IS NULL OR (SELECT private.check_user_project_financial_access(project_id)));

DROP POLICY IF EXISTS project_receipts_select_pov_scoped ON public.project_receipts;
DROP POLICY IF EXISTS project_receipts_select_financial ON public.project_receipts;
CREATE POLICY project_receipts_select_financial ON public.project_receipts
  FOR SELECT TO authenticated
  USING ((SELECT private.check_user_project_financial_access(project_id)));

DROP POLICY IF EXISTS documents_select_pov_scoped ON public.documents;
CREATE POLICY documents_select_pov_scoped ON public.documents
  FOR SELECT TO authenticated
  USING (
    (SELECT private.check_user_project_financial_access(project_id))
    OR (
      public.check_user_project_access(project_id, (SELECT auth.uid()))
      AND audience_pov IN ('KLIEN', 'UMUM')
      AND document_type NOT IN ('MUTASI_KAS', 'PO_PENGADAAN')
    )
  );

-- 5.15 Perkeras company_profile_change_requests, company_registration_requests, company_admin_seats, rfin_tokens, internal_notifications, role_catalog (InitPlan + TO authenticated)
DROP POLICY IF EXISTS csa_insert_requests ON public.company_profile_change_requests;
DROP POLICY IF EXISTS csa_own_company_requests ON public.company_profile_change_requests;
DROP POLICY IF EXISTS psa_all_profile_changes ON public.company_profile_change_requests;
DROP POLICY IF EXISTS cpcr_select_scoped ON public.company_profile_change_requests;
DROP POLICY IF EXISTS cpcr_insert_csa ON public.company_profile_change_requests;
DROP POLICY IF EXISTS cpcr_update_psa ON public.company_profile_change_requests;
CREATE POLICY cpcr_select_scoped ON public.company_profile_change_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR (SELECT private.is_company_admin_for_company(company_id))
  );
CREATE POLICY cpcr_insert_csa ON public.company_profile_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND (SELECT private.is_company_admin_for_company(company_id))
  );
CREATE POLICY cpcr_update_psa ON public.company_profile_change_requests
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

DROP POLICY IF EXISTS psa_all_requests ON public.company_registration_requests;
DROP POLICY IF EXISTS user_insert_requests ON public.company_registration_requests;
DROP POLICY IF EXISTS user_own_requests_select ON public.company_registration_requests;
DROP POLICY IF EXISTS crr_select_scoped ON public.company_registration_requests;
DROP POLICY IF EXISTS crr_insert_own ON public.company_registration_requests;
DROP POLICY IF EXISTS crr_update_psa ON public.company_registration_requests;
CREATE POLICY crr_select_scoped ON public.company_registration_requests
  FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()) OR (SELECT private.is_platform_super_admin()));
CREATE POLICY crr_insert_own ON public.company_registration_requests
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = (SELECT auth.uid()));
CREATE POLICY crr_update_psa ON public.company_registration_requests
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

DROP POLICY IF EXISTS psa_manage_seats ON public.company_admin_seats;
DROP POLICY IF EXISTS recipient_view_own_seat ON public.company_admin_seats;
DROP POLICY IF EXISTS cas_select_scoped ON public.company_admin_seats;
DROP POLICY IF EXISTS cas_write_psa ON public.company_admin_seats;
CREATE POLICY cas_select_scoped ON public.company_admin_seats
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR lower(recipient_email) = lower(((SELECT auth.jwt()) ->> 'email'))
    OR (SELECT private.is_company_admin_for_company(company_id))
  );
CREATE POLICY cas_write_psa ON public.company_admin_seats
  FOR ALL TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

DROP POLICY IF EXISTS csa_view_company_tokens ON public.rfin_tokens;
DROP POLICY IF EXISTS psa_manage_tokens ON public.rfin_tokens;
DROP POLICY IF EXISTS token_recipient_select ON public.rfin_tokens;
DROP POLICY IF EXISTS rfin_tokens_select_scoped ON public.rfin_tokens;
DROP POLICY IF EXISTS rfin_tokens_write_admin ON public.rfin_tokens;
CREATE POLICY rfin_tokens_select_scoped ON public.rfin_tokens
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR (SELECT private.is_company_admin_for_company(company_id))
    OR lower(recipient_email) = lower(((SELECT auth.jwt()) ->> 'email'))
  );
CREATE POLICY rfin_tokens_write_admin ON public.rfin_tokens
  FOR ALL TO authenticated
  USING (
    (SELECT private.is_platform_super_admin())
    OR (SELECT private.is_company_admin_for_company(company_id))
  )
  WITH CHECK (
    (SELECT private.is_platform_super_admin())
    OR (SELECT private.is_company_admin_for_company(company_id))
  );

DROP POLICY IF EXISTS recipient_view_own_notifications ON public.internal_notifications;
DROP POLICY IF EXISTS recipient_update_own_notifications ON public.internal_notifications;
DROP POLICY IF EXISTS notif_select_scoped ON public.internal_notifications;
DROP POLICY IF EXISTS notif_update_own ON public.internal_notifications;
CREATE POLICY notif_select_scoped ON public.internal_notifications
  FOR SELECT TO authenticated
  USING (
    lower(recipient_email) = lower(((SELECT auth.jwt()) ->> 'email'))
    OR (SELECT private.is_platform_super_admin())
  );
CREATE POLICY notif_update_own ON public.internal_notifications
  FOR UPDATE TO authenticated
  USING (lower(recipient_email) = lower(((SELECT auth.jwt()) ->> 'email')))
  WITH CHECK (lower(recipient_email) = lower(((SELECT auth.jwt()) ->> 'email')));

DROP POLICY IF EXISTS all_read_role_catalog ON public.role_catalog;
DROP POLICY IF EXISTS psa_manage_role_catalog ON public.role_catalog;
DROP POLICY IF EXISTS role_catalog_select_auth ON public.role_catalog;
DROP POLICY IF EXISTS role_catalog_write_psa ON public.role_catalog;
CREATE POLICY role_catalog_select_auth ON public.role_catalog
  FOR SELECT TO authenticated USING (true);
CREATE POLICY role_catalog_write_psa ON public.role_catalog
  FOR ALL TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

DROP POLICY IF EXISTS all_read_role_perm ON public.role_permission_catalog;
DROP POLICY IF EXISTS psa_manage_role_perm ON public.role_permission_catalog;
DROP POLICY IF EXISTS role_perm_select_auth ON public.role_permission_catalog;
DROP POLICY IF EXISTS role_perm_write_psa ON public.role_permission_catalog;
CREATE POLICY role_perm_select_auth ON public.role_permission_catalog
  FOR SELECT TO authenticated USING (true);
CREATE POLICY role_perm_write_psa ON public.role_permission_catalog
  FOR ALL TO authenticated
  USING ((SELECT private.is_platform_super_admin()))
  WITH CHECK ((SELECT private.is_platform_super_admin()));

-- 6. PERKERAS STORAGE BUCKET 'receipts' (PRIVAT + BATAS 10MB + MIME + SCOPED RLS)
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'receipts';

DROP POLICY IF EXISTS "Public Access Receipts" ON storage.objects;
DROP POLICY IF EXISTS "Allow Upload Receipts" ON storage.objects;
DROP POLICY IF EXISTS "Allow Update Receipts" ON storage.objects;
DROP POLICY IF EXISTS "Allow Delete Receipts" ON storage.objects;
DROP POLICY IF EXISTS receipts_select_scoped ON storage.objects;
DROP POLICY IF EXISTS receipts_insert_scoped ON storage.objects;
DROP POLICY IF EXISTS receipts_update_scoped ON storage.objects;
DROP POLICY IF EXISTS receipts_delete_scoped ON storage.objects;

CREATE POLICY receipts_select_scoped ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (SELECT private.check_user_storage_receipt_access(name)));
CREATE POLICY receipts_insert_scoped ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (SELECT private.check_user_storage_receipt_access(name)));
CREATE POLICY receipts_update_scoped ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND (SELECT private.check_user_storage_receipt_access(name)))
  WITH CHECK (bucket_id = 'receipts' AND (SELECT private.check_user_storage_receipt_access(name)));
CREATE POLICY receipts_delete_scoped ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND (SELECT private.check_user_storage_receipt_access(name)));

-- 7. INDEKS FOREIGN KEY UTAMA (PERFORMANCE ADVISORS)
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_project_id ON public.inventory_transactions (project_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item_id ON public.inventory_transactions (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_receipt_id ON public.inventory_transactions (receipt_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_project_id ON public.boq_items (project_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_parent_section_id ON public.boq_items (parent_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_project_id ON public.boq_sections (project_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user_id ON public.project_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_workspace_id ON public.project_memberships (workspace_id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_user_id ON public.company_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_company_id ON public.company_memberships (company_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON public.projects (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_company_id ON public.workspaces (company_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON public.workspaces (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_inv_reversals_project_id ON public.inventory_transaction_reversals (project_id);
CREATE INDEX IF NOT EXISTS idx_cash_reversals_project_id ON public.cash_transaction_reversals (project_id);

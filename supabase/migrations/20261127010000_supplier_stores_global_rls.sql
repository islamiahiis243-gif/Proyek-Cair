-- 20261127010000_supplier_stores_global_rls.sql
-- Longgarkan RLS supplier_stores untuk mendukung katalog toko global (project_id IS NULL)

DROP POLICY IF EXISTS supplier_stores_financial_access ON public.supplier_stores;
CREATE POLICY supplier_stores_financial_access ON public.supplier_stores
  FOR ALL TO authenticated
  USING (project_id IS NULL OR (SELECT private.check_user_project_financial_access(project_id)))
  WITH CHECK (project_id IS NULL OR (SELECT private.check_user_project_financial_access(project_id)));

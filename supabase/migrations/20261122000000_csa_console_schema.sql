-- Migration untuk Company Console & Company Super Admin
-- 1. Tambah kolom is_company_super_admin ke company_memberships
ALTER TABLE public.company_memberships 
ADD COLUMN IF NOT EXISTS is_company_super_admin boolean NOT NULL DEFAULT false;

-- 2. Update status CSA untuk semua pemegang kursi claimed
UPDATE public.company_memberships cm
SET is_company_super_admin = true
FROM public.company_admin_seats cas
WHERE cas.company_id = cm.company_id
  AND cas.claimed_by = cm.user_id
  AND cas.seat_status = 'CLAIMED';

-- 3. Tabel project_client_relationships
CREATE TABLE IF NOT EXISTS public.project_client_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  relationship_type text NOT NULL DEFAULT 'CLIENT',
  commercial_reference text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.project_client_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcr_authenticated ON public.project_client_relationships;
CREATE POLICY pcr_authenticated ON public.project_client_relationships FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.project_client_relationships TO postgres, authenticated, anon, service_role;

-- 4. Tabel authority_catalog
CREATE TABLE IF NOT EXISTS public.authority_catalog (
  authority_code text PRIMARY KEY,
  permission_code text,
  display_name text NOT NULL,
  description text,
  allowed_dimensions text[] DEFAULT ARRAY[]::text[],
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.authority_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ac_authenticated ON public.authority_catalog;
CREATE POLICY ac_authenticated ON public.authority_catalog FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.authority_catalog TO postgres, authenticated, anon, service_role;

-- 5. Tabel company_member_access_assignments
CREATE TABLE IF NOT EXISTS public.company_member_access_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_membership_id uuid REFERENCES public.company_memberships(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assignment_type text NOT NULL,
  code text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  scope jsonb DEFAULT '{}'::jsonb,
  max_amount numeric,
  currency text,
  reason text,
  starts_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.company_member_access_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmaa_authenticated ON public.company_member_access_assignments;
CREATE POLICY cmaa_authenticated ON public.company_member_access_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.company_member_access_assignments TO postgres, authenticated, anon, service_role;

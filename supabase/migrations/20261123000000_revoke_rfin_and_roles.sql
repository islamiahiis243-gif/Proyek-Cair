-- Migration: Tambah kolom nama_item_aktual ke inventory_transactions dan fungsi pencabutan RFIN/role
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS nama_item_aktual text DEFAULT NULL;

-- Fungsi pencabutan undangan RFIN-B (bisa membatalkan yang belum diklaim atau mencabut yang sudah diklaim)
CREATE OR REPLACE FUNCTION public.revoke_rfin_invitation(p_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t record;
  v_pid uuid;
  v_role text;
  v_uid uuid;
  v_pm_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.rfin_tokens WHERE id = p_token_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Undangan tidak ditemukan.');
  END IF;

  IF NOT public.is_company_admin(v_t.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Company Super Admin yang dapat membatalkan atau mencabut undangan.');
  END IF;

  -- Jika belum pernah diklaim: batalkan undangan token
  IF v_t.redeemed_at IS NULL THEN
    UPDATE public.rfin_tokens
    SET revoked_at = coalesce(revoked_at, now())
    WHERE id = p_token_id;

    RETURN jsonb_build_object('ok', true, 'action', 'BATALKAN', 'message', 'Undangan berhasil dibatalkan. Token ini tidak dapat digunakan lagi.');
  END IF;

  -- Jika sudah diklaim: cabut penugasan yang diberikan oleh token ini
  v_uid := v_t.redeemed_by;
  v_role := v_t.snapshot->>'role_code';

  IF v_uid IS NOT NULL AND v_role IS NOT NULL THEN
    FOR v_pid IN SELECT (jsonb_array_elements_text(v_t.snapshot->'project_ids'))::uuid LOOP
      FOR v_pm_id IN 
        SELECT id FROM public.project_memberships 
        WHERE project_id = v_pid AND user_id = v_uid AND role_code = v_role AND membership_status = 'ACTIVE'
      LOOP
        UPDATE public.project_memberships
        SET membership_status = 'REVOKED', updated_at = now()
        WHERE id = v_pm_id;

        DELETE FROM public.project_membership_permissions
        WHERE project_membership_id = v_pm_id;
      END LOOP;
    END LOOP;
  END IF;

  -- Tandai token sebagai dicabut
  UPDATE public.rfin_tokens
  SET revoked_at = now()
  WHERE id = p_token_id;

  RETURN jsonb_build_object('ok', true, 'action', 'CABUT', 'message', 'Akses dan penugasan jabatan dari undangan ini telah berhasil dicabut.');
END;
$$;

-- Fungsi pencabutan peran spesifik anggota proyek
CREATE OR REPLACE FUNCTION public.revoke_project_member_role(
  p_project_id uuid,
  p_user_id uuid,
  p_role_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pm_id uuid;
  v_ws uuid;
  v_cid uuid;
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Autentikasi diperlukan.');
  END IF;

  SELECT workspace_id INTO v_ws FROM public.projects WHERE id = p_project_id;
  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Proyek tidak ditemukan.');
  END IF;

  SELECT company_id INTO v_cid FROM public.workspaces WHERE id = v_ws;
  IF v_cid IS NOT NULL THEN
    v_is_admin := public.is_company_admin(v_cid);
  END IF;

  IF NOT v_is_admin THEN
    v_is_admin := exists (
      SELECT 1 FROM public.project_memberships
      WHERE project_id = p_project_id AND user_id = v_caller AND role_code IN ('PROJECT_MANAGER', 'KTT_PM') AND membership_status = 'ACTIVE'
    );
  END IF;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tidak berwenang mencabut penugasan pada proyek ini.');
  END IF;

  FOR v_pm_id IN 
    SELECT id FROM public.project_memberships 
    WHERE project_id = p_project_id AND user_id = p_user_id AND role_code = p_role_code AND membership_status = 'ACTIVE'
  LOOP
    UPDATE public.project_memberships
    SET membership_status = 'REVOKED', updated_at = now()
    WHERE id = v_pm_id;

    DELETE FROM public.project_membership_permissions
    WHERE project_membership_id = v_pm_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'message', 'Jabatan berhasil dicabut dari anggota proyek.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_rfin_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_project_member_role(uuid, uuid, text) TO authenticated;

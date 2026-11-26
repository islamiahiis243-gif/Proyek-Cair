-- ==============================================================================
-- 20261126000000_public_document_verification.sql
-- RPC Publik untuk verifikasi keabsahan dokumen & TTE digital via QR code
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.verify_public_document(p_doc_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc record;
  v_proj record;
  v_comp_name text;
  v_result jsonb;
BEGIN
  IF p_doc_id IS NULL OR trim(p_doc_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ID Dokumen tidak valid');
  END IF;

  SELECT * INTO v_doc
  FROM public.documents
  WHERE id::text = p_doc_id
     OR document_no = p_doc_id
     OR verification_token = p_doc_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dokumen tidak ditemukan pada sistem registrasi');
  END IF;

  SELECT name, workspace_id INTO v_proj FROM public.projects WHERE id = v_doc.project_id;
  
  -- Ambil nama perusahaan dari display_name workspace
  SELECT w.display_name INTO v_comp_name
  FROM public.workspaces w
  WHERE w.id = v_doc.workspace_id;

  v_result := jsonb_build_object(
    'ok', true,
    'document_no', v_doc.document_no,
    'title', v_doc.title,
    'document_type', v_doc.document_type,
    'period_start', v_doc.period_start,
    'period_end', v_doc.period_end,
    'status', v_doc.status,
    'status_dokumen', COALESCE(v_doc.status_dokumen, 'DITERBITKAN'),
    'content_sha256', v_doc.content_sha256,
    'issued_at', v_doc.issued_at,
    'signer_name', v_doc.signer_name,
    'signer_role', v_doc.signer_role,
    'diperiksa_oleh', v_doc.diperiksa_oleh,
    'disetujui_oleh', v_doc.disetujui_oleh,
    'mengetahui_oleh', v_doc.mengetahui_oleh,
    'tte_qr_code', v_doc.tte_qr_code,
    'is_batal', COALESCE(v_doc.is_batal, false),
    'is_ganti', COALESCE(v_doc.is_ganti, false),
    'project_name', COALESCE(v_proj.name, 'Proyek Konstruksi'),
    'company_name', COALESCE(v_comp_name, 'Perusahaan'),
    'created_at', v_doc.created_at
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_public_document(text) TO anon, authenticated;

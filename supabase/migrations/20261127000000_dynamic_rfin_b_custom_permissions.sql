-- Migration: RFIN-B Dinamis dengan Toggle Wewenang Kustom oleh CSA
-- Mengakomodasi proyek skala menengah-bawah (1 klerk lapangan / solo / belum multi-kursi)

ALTER TABLE public.project_memberships
  ADD COLUMN IF NOT EXISTS custom_permissions jsonb DEFAULT '{}'::jsonb;

-- Overload / perbarui fungsi issue_rfin_b dengan parameter custom_permissions
CREATE OR REPLACE FUNCTION public.issue_rfin_b(
  p_company_id uuid,
  p_recipient_email text,
  p_role_code text,
  p_project_ids uuid[],
  p_expires_in interval default '7 days',
  p_can_view_financials boolean default true,
  p_custom_permissions jsonb default '{}'::jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_ws uuid; 
  v_company text; 
  v_role text; 
  v_raw text; 
  v_code text;
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Hanya Company Super Admin yang dapat menerbitkan RFIN-B.';
  end if;

  if p_recipient_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Format email penerima tidak valid.';
  end if;

  select display_name into v_role from public.role_catalog where role_code = p_role_code and active;
  if v_role is null then raise exception 'Peran tidak dikenal.'; end if;

  if coalesce(array_length(p_project_ids,1),0) = 0 then
    raise exception 'Pilih minimal satu project.';
  end if;

  select w.id, c.legal_name into v_ws, v_company
    from public.workspaces w join public.companies c on c.id = w.company_id
    where w.company_id = p_company_id limit 1;
  if v_ws is null then raise exception 'Workspace perusahaan tidak ditemukan.'; end if;

  if exists (select 1 from unnest(p_project_ids) pid
             where not exists (select 1 from public.projects p where p.id = pid and p.workspace_id = v_ws)) then
    raise exception 'Ada project yang bukan milik perusahaan ini.';
  end if;

  -- Cabut hanya undangan lama yang belum dipakai untuk email DAN jabatan yang sama
  update public.rfin_tokens set revoked_at = now()
   where company_id = p_company_id and token_class = 'RFIN_B'
     and lower(recipient_email) = lower(trim(p_recipient_email))
     and snapshot->>'role_code' = p_role_code
     and redeemed_at is null and revoked_at is null;

  -- Buat kode baru menggunakan gen_random_uuid()
  v_raw := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code := 'RFB-' || substr(v_raw,1,4) || '-' || substr(v_raw,5,4) || '-' || substr(v_raw,9,4);

  insert into public.rfin_tokens
    (token_code, token_class, company_id, workspace_id, recipient_email, expires_at, issued_by, snapshot)
  values (
    v_code, 'RFIN_B', p_company_id, v_ws, lower(trim(p_recipient_email)),
    now() + p_expires_in, auth.uid(),
    jsonb_build_object(
      'company_name', v_company, 
      'role_code', p_role_code,
      'personas', jsonb_build_array(jsonb_build_object('name', v_role)),
      'project_ids', to_jsonb(p_project_ids),
      'can_view_financials', coalesce(p_can_view_financials, true),
      'custom_permissions', coalesce(p_custom_permissions, '{}'::jsonb)
    )
  );

  -- Kirim ke notifikasi internal penerima
  insert into public.internal_notifications
    (recipient_email, title, category, message, token_code, action_type, company_name)
  values
    (
      lower(trim(p_recipient_email)),
      'Undangan Penugasan Proyek (RFIN-B) - ' || v_company,
      'RFIN_B',
      'Anda telah ditugaskan sebagai ' || v_role || ' untuk ' || v_company || '. Gunakan kode aktivasi ini untuk bergabung ke proyek.',
      v_code,
      'CLAIM_RFIN',
      v_company
    );

  return v_code;
end $$;

-- Perbarui fungsi redeem_rfin untuk memindahkan custom_permissions ke project_memberships
CREATE OR REPLACE FUNCTION public.redeem_rfin(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid := auth.uid(); v_email text; v_t record; v_ws uuid;
  v_cm uuid; v_pm uuid; v_pid uuid; v_role text;
  v_custom_perms jsonb;
  v_can_fin boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Autentikasi diperlukan.'); end if;
  select email into v_email from auth.users where id = v_uid;
  select * into v_t from public.rfin_tokens
   where token_code = upper(trim(p_code)) and revoked_at is null and redeemed_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Kode tidak valid atau sudah digunakan.'); end if;
  if v_t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'Kode sudah kedaluwarsa.'); end if;
  if lower(v_t.recipient_email) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'error', 'Kode ini tidak ditujukan untuk akun Anda.');
  end if;

  if v_t.token_class = 'RFIN_A' then
    update public.company_admin_seats set seat_status='CLAIMED', claimed_by=v_uid, claimed_at=now()
     where company_id = v_t.company_id and seat_status = 'UNCLAIMED';
    select id into v_ws from public.workspaces where company_id = v_t.company_id limit 1;
    insert into public.company_memberships (workspace_id, company_id, user_id, membership_status, is_company_super_admin)
      values (v_ws, v_t.company_id, v_uid, 'ACTIVE', true)
      on conflict (workspace_id, user_id) do update set membership_status = 'ACTIVE', is_company_super_admin = true;
    update public.rfin_tokens set redeemed_at = now(), redeemed_by = v_uid where id = v_t.id;
    
    update public.internal_notifications 
    set is_claimed = true, is_read = true 
    where lower(recipient_email) = lower(v_email)
      and category = 'RFIN_A';

    return jsonb_build_object('ok', true, 'token_class', 'RFIN_A', 'workspace_id', v_ws);
  end if;

  -- RFIN_B: Penugasan Jabatan pada Proyek dengan Wewenang Kustom
  v_ws := v_t.workspace_id;
  v_role := v_t.snapshot->>'role_code';
  v_custom_perms := coalesce(v_t.snapshot->'custom_permissions', '{}'::jsonb);
  v_can_fin := coalesce((v_t.snapshot->>'can_view_financials')::boolean, true);

  insert into public.company_memberships (workspace_id, company_id, user_id, membership_status, is_company_super_admin)
    values (v_ws, v_t.company_id, v_uid, 'ACTIVE', false)
    on conflict (workspace_id, user_id) do update set membership_status = 'ACTIVE'
    returning id into v_cm;
    
  for v_pid in select (jsonb_array_elements_text(v_t.snapshot->'project_ids'))::uuid loop
    insert into public.project_memberships (workspace_id, project_id, company_membership_id, user_id, membership_status, role_code, can_view_financials, custom_permissions)
      values (v_ws, v_pid, v_cm, v_uid, 'ACTIVE', v_role, v_can_fin, v_custom_perms)
      on conflict (project_id, user_id) do update
        set role_code = excluded.role_code,
            membership_status = 'ACTIVE', 
            company_membership_id = excluded.company_membership_id,
            can_view_financials = excluded.can_view_financials,
            custom_permissions = excluded.custom_permissions
      returning id into v_pm;
      
    delete from public.project_membership_permissions where project_membership_id = v_pm;
    insert into public.project_membership_permissions (project_membership_id, permission_code)
      select v_pm, rp.permission_code from public.role_permission_catalog rp
       where rp.role_code = v_role and rp.active;
  end loop;
  
  update public.rfin_tokens set redeemed_at = now(), redeemed_by = v_uid where id = v_t.id;
  
  update public.internal_notifications 
  set is_claimed = true, is_read = true 
  where token_code = v_t.token_code;

  return jsonb_build_object('ok', true, 'token_class', 'RFIN_B', 'workspace_id', v_ws, 'role_code', v_role);
end $$;

-- Perbarui resolve_my_active_context untuk menyertakan custom_permissions (VOLATILE karena menginisialisasi personal workspace & update profile)
CREATE OR REPLACE FUNCTION public.resolve_my_active_context()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid := auth.uid(); v_ws uuid; v_workspaces jsonb; v_projects jsonb; v_psa boolean;
begin
  if v_uid is null then return jsonb_build_object('authenticated', false); end if;

  select id into v_ws from public.workspaces where owner_user_id = v_uid and workspace_type = 'PERSONAL' limit 1;
  if v_ws is null then
    insert into public.workspaces (workspace_type, display_name, owner_user_id, status)
    values ('PERSONAL', 'Personal Workspace', v_uid, 'ACTIVE') returning id into v_ws;
  end if;
  update public.profiles set personal_workspace_id = v_ws
   where id = v_uid and personal_workspace_id is distinct from v_ws;

  select exists (select 1 from public.profiles where id = v_uid and role = 'PLATFORM_SUPER_ADMIN') into v_psa;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id, 'type', w.workspace_type, 'name', coalesce(c.legal_name, w.display_name), 'status', w.status, 'company_id', w.company_id,
    'company_npwp', coalesce(c.npwp, ''),
    'company_logo_url', coalesce(c.logo_url, ''),
    'is_company_super_admin', exists (select 1 from public.company_memberships cmx where cmx.workspace_id = w.id and cmx.user_id = v_uid and cmx.membership_status = 'ACTIVE' and cmx.is_company_super_admin = true),
    'access_basis', case when w.workspace_type = 'PERSONAL' then 'PERSONAL_OWNER' else 'ACTIVE_COMPANY_MEMBERSHIP' end)), '[]'::jsonb)
  into v_workspaces from public.workspaces w
  left join public.companies c on c.id = w.company_id
  where w.owner_user_id = v_uid
     or exists (select 1 from public.company_memberships cm
                where cm.workspace_id = w.id and cm.user_id = v_uid and cm.membership_status = 'ACTIVE');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 
    'workspace_id', p.workspace_id, 
    'company_id', w.company_id,
    'company_name', coalesce(c.legal_name, w.display_name),
    'company_npwp', coalesce(c.npwp, ''),
    'company_logo_url', coalesce(c.logo_url, ''),
    'project_code', p.project_code, 
    'name', p.name,
    'status', p.status, 
    'membership_id', pm.id, 
    'role_code', coalesce(pm.role_code, 'CLERK'),
    'role_name', coalesce(rc.display_name, pm.role_code, 'Clerk / Juru Tulis'),
    'can_view_financials', coalesce(pm.can_view_financials, true),
    'custom_permissions', coalesce(pm.custom_permissions, '{}'::jsonb),
    'permissions', coalesce((select jsonb_agg(x.permission_code) from public.project_membership_permissions x
                             where x.project_membership_id = pm.id), '[]'::jsonb))), '[]'::jsonb)
  into v_projects from public.projects p
  join public.project_memberships pm on pm.project_id = p.id and pm.user_id = v_uid and pm.membership_status = 'ACTIVE'
  join public.workspaces w on w.id = p.workspace_id
  left join public.companies c on c.id = w.company_id
  left join public.role_catalog rc on rc.role_code = pm.role_code;

  return jsonb_build_object('authenticated', true, 'user_id', v_uid,
    'is_platform_super_admin', v_psa, 'workspaces', v_workspaces, 'projects', v_projects);
end $$;

GRANT EXECUTE ON FUNCTION public.issue_rfin_b(uuid,text,text,uuid[],interval,boolean,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_rfin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_my_active_context() TO authenticated;

-- Tahap 4: Alur RFIN-B (CSA menerbitkan token ke anggota, anggota redeem -> peran Impersonate)

-- Peran tersimpan per keanggotaan project (satu peran dari role_catalog)
alter table public.project_memberships
  add column if not exists role_code text references public.role_catalog(role_code);

-- Pembantu: apakah pengguna saat ini adalah CSA aktif dari company tertentu
create or replace function public.is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_admin_seats
    where company_id = p_company_id and claimed_by = auth.uid() and seat_status = 'CLAIMED'
  );
$$;

-- CSA boleh melihat token milik company-nya
drop policy if exists "csa_view_company_tokens" on public.rfin_tokens;
create policy "csa_view_company_tokens" on public.rfin_tokens
  for select using (public.is_company_admin(company_id));

-- Terbitkan RFIN-B (hanya CSA)
create or replace function public.issue_rfin_b(
  p_company_id uuid,
  p_recipient_email text,
  p_role_code text,
  p_project_ids uuid[],
  p_expires_in interval default '7 days'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid; v_company text; v_role text; v_raw text; v_code text;
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

  -- cabut undangan lama yang belum dipakai untuk email yang sama
  update public.rfin_tokens set revoked_at = now()
   where company_id = p_company_id and token_class = 'RFIN_B'
     and lower(recipient_email) = lower(trim(p_recipient_email))
     and redeemed_at is null and revoked_at is null;

  v_raw := upper(encode(gen_random_bytes(9), 'hex'));
  v_code := 'RFB-' || substr(v_raw,1,4) || '-' || substr(v_raw,5,4) || '-' || substr(v_raw,9,4);

  insert into public.rfin_tokens
    (token_code, token_class, company_id, workspace_id, recipient_email, expires_at, issued_by, snapshot)
  values (v_code, 'RFIN_B', p_company_id, v_ws, lower(trim(p_recipient_email)),
          now() + p_expires_in, auth.uid(),
          jsonb_build_object('company_name', v_company, 'role_code', p_role_code,
            'personas', jsonb_build_array(jsonb_build_object('name', v_role)),
            'project_ids', to_jsonb(p_project_ids)));
  return v_code;
end $$;

-- Daftar RFIN-B milik company (untuk CSA)
create or replace function public.list_company_rfin_b(p_company_id uuid)
returns table(token_id uuid, recipient_email text, created_at timestamptz, expires_at timestamptz,
              redeemed_at timestamptz, revoked_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Hanya Company Super Admin yang dapat melihat daftar ini.';
  end if;
  return query select t.id, t.recipient_email, t.created_at, t.expires_at, t.redeemed_at, t.revoked_at, t.snapshot
    from public.rfin_tokens t where t.company_id = p_company_id and t.token_class = 'RFIN_B'
    order by t.created_at desc;
end $$;

-- Cabut RFIN-B (hanya yang belum dipakai)
create or replace function public.revoke_rfin(p_token_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  select * into v_t from public.rfin_tokens where id = p_token_id;
  if not found then raise exception 'Token tidak ditemukan.'; end if;
  if not public.is_company_admin(v_t.company_id) then
    raise exception 'Tidak berwenang mencabut token ini.';
  end if;
  if v_t.redeemed_at is not null then raise exception 'Token sudah dipakai dan tidak dapat dicabut.'; end if;
  update public.rfin_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
end $$;

-- Redeem: RFIN-A (klaim kursi CSA) dan RFIN-B (terapkan snapshot peran)
create or replace function public.redeem_rfin(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_email text; v_t record; v_ws uuid;
  v_cm uuid; v_pm uuid; v_pid uuid; v_role text;
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
    insert into public.company_memberships (workspace_id, company_id, user_id, membership_status)
      values (v_ws, v_t.company_id, v_uid, 'ACTIVE')
      on conflict (workspace_id, user_id) do update set membership_status = 'ACTIVE';
    update public.rfin_tokens set redeemed_at = now(), redeemed_by = v_uid where id = v_t.id;
    return jsonb_build_object('ok', true, 'token_class', 'RFIN_A', 'workspace_id', v_ws);
  end if;

  -- RFIN_B
  v_ws := v_t.workspace_id;
  v_role := v_t.snapshot->>'role_code';
  insert into public.company_memberships (workspace_id, company_id, user_id, membership_status)
    values (v_ws, v_t.company_id, v_uid, 'ACTIVE')
    on conflict (workspace_id, user_id) do update set membership_status = 'ACTIVE'
    returning id into v_cm;
  for v_pid in select (jsonb_array_elements_text(v_t.snapshot->'project_ids'))::uuid loop
    insert into public.project_memberships (workspace_id, project_id, company_membership_id, user_id, membership_status, role_code)
      values (v_ws, v_pid, v_cm, v_uid, 'ACTIVE', v_role)
      on conflict (project_id, user_id) do update
        set membership_status = 'ACTIVE', role_code = excluded.role_code, company_membership_id = excluded.company_membership_id
      returning id into v_pm;
    delete from public.project_membership_permissions where project_membership_id = v_pm;
    insert into public.project_membership_permissions (project_membership_id, permission_code)
      select v_pm, rp.permission_code from public.role_permission_catalog rp
       where rp.role_code = v_role and rp.active;
  end loop;
  update public.rfin_tokens set redeemed_at = now(), redeemed_by = v_uid where id = v_t.id;
  return jsonb_build_object('ok', true, 'token_class', 'RFIN_B', 'workspace_id', v_ws, 'role_code', v_role);
end $$;

grant execute on function public.issue_rfin_b(uuid,text,text,uuid[],interval) to authenticated;
grant execute on function public.list_company_rfin_b(uuid) to authenticated;
grant execute on function public.revoke_rfin(uuid) to authenticated;
grant execute on function public.redeem_rfin(text) to authenticated;
grant execute on function public.is_company_admin(uuid) to authenticated;

-- Read-only regression for the 27 authenticated-callable SECURITY DEFINER RPCs reported by Supabase Security Advisor.
-- This test does not alter data or grants. It verifies that every expected entry point
-- remains authenticated-only, has a hardened search_path (legacy current_user_role is
-- separately checked because its profile RLS policy intentionally calls it), and retains
-- a caller-bound or guarded authorization path.

do $$
declare
  v_name text;
  v_oid oid;
  v_def text;
  v_config text;
  v_expected text[] := array[
    'assign_company_member_access',
    'assign_company_member_to_project',
    'cancel_project_document_scoped',
    'create_boq_addition_scoped',
    'create_procurement_request_scoped',
    'create_project_document_replacement_scoped',
    'create_project_document_snapshot_scoped',
    'create_workflow_definition_scoped',
    'create_workflow_definition_steps_scoped',
    'current_user_role',
    'get_company_console_dashboard',
    'get_company_member_access_assignments',
    'get_company_project_assignment_coverage',
    'import_project_backup_scoped',
    'issue_procurement_order_scoped',
    'list_company_audit_events',
    'list_my_final_signatory_documents',
    'receive_procurement_order_scoped',
    'record_cash_mutation_scoped',
    'record_inventory_mutation_scoped',
    'reverse_cash_transaction_scoped',
    'reverse_inventory_transaction_scoped',
    'revoke_company_member_access',
    'start_project_workflow_from_definition',
    'submit_procurement_request_scoped',
    'update_boq_addition_scoped',
    'update_boq_billing_status_scoped'
  ];
  v_seen integer := 0;
begin
  foreach v_name in array v_expected loop
    select p.oid, pg_get_functiondef(p.oid), coalesce(array_to_string(p.proconfig, ','), '')
      into v_oid, v_def, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;

    if v_oid is null then
      raise exception 'Expected SECURITY DEFINER RPC is missing: %', v_name;
    end if;

    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception 'Expected SECURITY DEFINER RPC lost SECURITY DEFINER: %', v_name;
    end if;

    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'anon can execute SECURITY DEFINER RPC: %', v_name;
    end if;

    if exists (
      select 1
      from aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid = v_oid),
        acldefault('f', (select p.proowner from pg_proc p where p.oid = v_oid))
      )) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute SECURITY DEFINER RPC: %', v_name;
    end if;

    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'authenticated EXECUTE grant unexpectedly missing: %', v_name;
    end if;

    if v_name <> 'current_user_role' and position('search_path=""' in v_config) = 0 then
      raise exception 'SECURITY DEFINER RPC must use an empty search_path: % (%).', v_name, v_config;
    end if;

    if v_name = 'current_user_role' then
      if position('auth.uid()' in v_def) = 0 or position('public.profiles' in v_def) = 0 then
        raise exception 'Legacy current_user_role must remain bound to the caller profile';
      end if;
    elsif v_name = 'list_company_audit_events' then
      if position('private.is_company_super_admin' in v_def) = 0 then
        raise exception 'Company audit RPC must retain the Company Super Admin guard';
      end if;
    elsif v_name = 'start_project_workflow_from_definition' then
      if position('private.start_project_workflow_steps' in v_def) = 0 then
        raise exception 'Workflow wrapper must delegate to the guarded atomic workflow engine';
      end if;
    elsif position('auth.uid()' in v_def) = 0
      and position('private.is_company_super_admin' in v_def) = 0
      and position('private.has_project_permission' in v_def) = 0 then
      raise exception 'SECURITY DEFINER RPC has no visible caller-bound authorization guard: %', v_name;
    end if;

    v_seen := v_seen + 1;
  end loop;

  if v_seen <> 27 then
    raise exception 'Expected 27 audited RPCs, checked %', v_seen;
  end if;
end
$$;

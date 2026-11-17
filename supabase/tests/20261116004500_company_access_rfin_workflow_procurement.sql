-- Structural/security regression assertions for the combined 20261116004500 baseline and 20261116012800 forward delta.
-- Run after applying the matching migration to a disposable local database or the user's manually managed target.
do $$
declare v_def text; v_count integer;
begin
 foreach v_def in array array[
  'public.persona_catalog','public.role_catalog','public.role_permission_catalog','public.authority_catalog',
  'public.company_membership_persona_assignments','public.company_membership_role_assignments','public.company_membership_authority_assignments',
  'public.user_active_persona_contexts','public.workflow_definitions','public.workflow_instances','public.workflow_steps','public.workflow_events',
  'public.workflow_step_delegations','public.user_notifications','public.project_signatory_appointments',
  'public.procurement_requests','public.procurement_request_items','public.procurement_orders','public.procurement_order_items',
  'public.goods_receipts','public.goods_receipt_items','public.cash_transaction_reversals'
 ] loop
  if to_regclass(v_def) is null then raise exception 'Required SSOT table missing: %',v_def; end if;
 end loop;

 if not exists(select 1 from public.persona_catalog where persona_code='FINANCE' and active)
  or not exists(select 1 from public.persona_catalog where persona_code='SITE_ENGINEER' and active) then
  raise exception 'SSOT persona examples missing';
 end if;
 select count(*) into v_count from public.role_catalog where active;
 if v_count<>8 then raise exception 'Expected exactly eight initial SSOT role presets, got %',v_count; end if;
 if exists(select 1 from public.role_permission_catalog where active and (approved_by is null or approved_at is null)) then
  raise exception 'Every active role-permission mapping must be explicitly approved by Platform Super Admin';
 end if;

 if not (select relrowsecurity from pg_class where oid='public.persona_catalog'::regclass)
  or not (select relrowsecurity from pg_class where oid='public.role_catalog'::regclass)
  or not (select relrowsecurity from pg_class where oid='public.authority_catalog'::regclass)
  or not (select relrowsecurity from pg_class where oid='public.workflow_instances'::regclass)
  or not (select relrowsecurity from pg_class where oid='public.procurement_requests'::regclass) then
  raise exception 'RLS must be enabled on access, workflow and procurement tables';
 end if;

 if has_table_privilege('authenticated','public.user_notifications','INSERT')
  or has_table_privilege('authenticated','public.cash_transaction_reversals','INSERT')
  or has_table_privilege('authenticated','public.company_membership_persona_assignments','INSERT')
  or has_table_privilege('authenticated','public.company_membership_role_assignments','INSERT')
  or has_table_privilege('authenticated','public.company_membership_authority_assignments','INSERT')
  or has_table_privilege('authenticated','public.workflow_instances','INSERT')
  or has_table_privilege('authenticated','public.workflow_steps','INSERT')
  or has_table_privilege('authenticated','public.procurement_requests','INSERT')
  or has_table_privilege('authenticated','public.procurement_orders','INSERT') then
  raise exception 'Authenticated direct inserts bypass server-controlled assignment/workflow/procurement RPCs';
 end if;

 select pg_get_functiondef('private.has_project_permission(uuid,text)'::regprocedure) into v_def;
 if position('user_active_persona_contexts' in v_def)=0 or position('role_permission_catalog' in v_def)=0 then
  raise exception 'Effective permission check must include active Persona and approved Role mapping';
 end if;
 select pg_get_functiondef('private.has_project_authority(uuid,text,numeric,text,jsonb)'::regprocedure) into v_def;
 if position('max_amount' in v_def)=0 or position('scope' in v_def)=0 then raise exception 'Authority limits/scope are not enforced'; end if;
 select pg_get_functiondef('private.project_scope_guard(uuid,text)'::regprocedure) into v_def;
 if position('operational_project_scope_enabled' in v_def)>0 then raise exception 'Project scope guard must not bypass when legacy cutover flag is OFF'; end if;

 if not exists(select 1 from pg_proc where oid='public.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text)'::regprocedure) then raise exception 'RFIN-B snapshot issuance RPC missing'; end if;
 if not exists(select 1 from pg_proc where oid='public.preview_rfin_redemption(text)'::regprocedure) then raise exception 'Recipient-bound RFIN preview missing'; end if;
 if not exists(select 1 from pg_proc where oid='public.redeem_rfin(text)'::regprocedure) then raise exception 'Atomic RFIN redemption RPC missing'; end if;
 select pg_get_functiondef('private.redeem_rfin(text)'::regprocedure) into v_def;
 if position('company_membership_persona_assignments' in v_def)=0 or position('company_membership_role_assignments' in v_def)=0
  or position('company_membership_authority_assignments' in v_def)=0 or position('project_membership_permissions' in v_def)=0 then
  raise exception 'RFIN-B redemption does not apply the full access snapshot atomically';
 end if;

 if not exists(select 1 from pg_trigger where tgname='workflow_resource_transition' and not tgisinternal) then raise exception 'Workflow resource transition trigger missing'; end if;
 -- RFIN-B snapshot application is performed atomically inside private.redeem_rfin(text);
 -- no separate trigger is part of the current implementation contract.
 if not exists(select 1 from pg_proc where oid='public.start_project_workflow_from_definition(uuid,uuid,uuid,text,uuid[],text,uuid)'::regprocedure) then raise exception 'Definition-backed workflow start RPC missing'; end if;
 select pg_get_functiondef('public.start_project_workflow_from_definition(uuid,uuid,uuid,text,uuid[],text,uuid)'::regprocedure) into v_def;
 if position('private.start_project_workflow_steps' in v_def)=0 then raise exception 'Workflow start wrapper must delegate to the atomic guarded workflow engine'; end if;
 if not exists(select 1 from pg_proc where oid='public.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)'::regprocedure) then raise exception 'Workflow action RPC missing'; end if;
 if not exists(select 1 from pg_proc where oid='public.delegate_project_workflow_step(uuid,uuid,uuid,timestamptz,text)'::regprocedure) then raise exception 'Workflow delegation RPC missing'; end if;
 if not exists(select 1 from pg_proc where oid='public.reassign_project_workflow_step(uuid,uuid,uuid,text)'::regprocedure) then raise exception 'Workflow reassignment RPC missing'; end if;

 if not exists(select 1 from pg_proc where oid='public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)'::regprocedure)
  or not exists(select 1 from pg_proc where oid='public.issue_procurement_order_scoped(uuid,uuid,uuid,text)'::regprocedure)
  or not exists(select 1 from pg_proc where oid='public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) then
  raise exception 'Procurement request/order/receipt RPC missing';
 end if;

 -- Broad permissive policies on high-risk tables must not survive the scope closure.
 if exists(select 1 from pg_policies where schemaname='public'
  and tablename=any(array['boq_items','boq_sections','boq_additions','cash_transactions','inventory_transactions','documents','document_signatures','progress_logs','project_personnel','safety_reports','project_media','transaction_attachments'])
  and (qual='true' or with_check='true')) then raise exception 'Global true RLS policy remains on operational tables'; end if;
end $$;

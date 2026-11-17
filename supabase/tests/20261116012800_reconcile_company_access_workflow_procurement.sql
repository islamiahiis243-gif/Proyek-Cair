-- Run after migrations 20261116004500 and 20261116012800 are applied.
-- Structural/security regression checks only; business-data E2E remains a separate acceptance suite.
do $$
declare v_def text;
begin
 if to_regclass('public.workspace_business_holidays') is null then raise exception 'Tenant business holiday calendar missing'; end if;
 if not (select relrowsecurity from pg_class where oid='public.workspace_business_holidays'::regclass) then raise exception 'Holiday calendar RLS disabled'; end if;
 if has_table_privilege('authenticated','public.workspace_business_holidays','INSERT')
  or has_table_privilege('authenticated','public.workspace_business_holidays','UPDATE')
  or has_table_privilege('authenticated','public.workspace_business_holidays','DELETE') then
  raise exception 'Authenticated users must mutate holiday calendar only through audited RPC';
 end if;
 if not has_function_privilege('authenticated','public.set_workspace_business_holiday(uuid,date,text,boolean,text)','EXECUTE') then
  raise exception 'Company holiday management RPC unavailable';
 end if;
 if has_function_privilege('authenticated','private.add_business_days(timestamptz,integer,text,uuid)','EXECUTE') then
  raise exception 'Internal business-day calculator must not be directly executable by authenticated users';
 end if;
 select pg_get_functiondef('private.add_business_days(timestamptz,integer,text,uuid)'::regprocedure) into v_def;
 if position('workspace_business_holidays' in v_def)=0 or position('08:00' in v_def)=0 or position('17:00' in v_def)=0 then
  raise exception 'Business-day calculation must use tenant holidays and business hours';
 end if;
 select pg_get_functiondef('private.run_workflow_sla_sweep()'::regprocedure) into v_def;
 if position('private.add_business_days' in v_def)=0 or position('WORKFLOW_SLA_ESCALATION' in v_def)=0 then
  raise exception 'SLA escalation must use the tenant business-day interval after due date';
 end if;
 if not exists(select 1 from public.project_permission_catalog where permission_code='workflow.definition.create' and active)
  or not exists(select 1 from public.project_permission_catalog where permission_code='workflow.definition.update' and active) then
  raise exception 'SSOT workflow definition permissions missing';
 end if;
 select pg_get_functiondef('private.user_has_project_permission(uuid,uuid,text)'::regprocedure) into v_def;
 if position('user_active_persona_contexts' in v_def)=0 or position('company_membership_role_assignments' in v_def)=0 then
  raise exception 'Approver eligibility must include active Persona and Role permission mapping';
 end if;
 if to_regprocedure('private.workflow_resource_snapshot(uuid,text,uuid)') is null then
  raise exception 'Canonical resource snapshot helper missing';
 end if;
 select pg_get_functiondef('private.workflow_resource_snapshot(uuid,text,uuid)'::regprocedure) into v_def;
 if position('procurement_request_items' in v_def)=0 or position('inventory_transactions' in v_def)=0
  or position('documents' in v_def)=0 or position('safety_reports' in v_def)=0 then
  raise exception 'Resource snapshot helper must cover all canonical workflow resource families';
 end if;
 if has_function_privilege('authenticated','private.workflow_resource_snapshot(uuid,text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.has_company_member_permission(uuid,uuid,text)','EXECUTE') then
  raise exception 'Internal resource/signatory authorization helpers must not be directly executable by clients';
 end if;
 if not has_function_privilege('authenticated','public.list_my_final_signatory_documents()','EXECUTE')
  or has_function_privilege('anon','public.list_my_final_signatory_documents()','EXECUTE') then
  raise exception 'Final Signatory inbox must be authenticated-only';
 end if;
 if to_regprocedure('private.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid)') is not null
  or to_regprocedure('public.start_project_workflow(uuid,text,text,uuid,text,uuid[],text,text,uuid)') is not null then
  raise exception 'Legacy single-permission workflow start RPC must be removed';
 end if;
 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('authority_amount' in v_def)=0 or position('private.user_has_project_permission' in v_def)=0
  or position('WORKFLOW_STEP_SCHEDULED' in v_def)=0 or position('IDEMPOTENCY_KEY_REUSED' in v_def)=0
  or position('hashtextextended' in v_def)=0 or position('display_name' in v_def)=0
  or position('v_snapshot_steps' in v_def)=0 then
  raise exception 'Workflow start must snapshot resource authority, named stages, notify the serial chain and bind idempotency to its full payload';
 end if;
 if to_regprocedure('public.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)') is null then
  raise exception 'Idempotent public workflow action RPC missing';
 end if;
 if not has_function_privilege('authenticated','public.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)','EXECUTE')
  or to_regprocedure('public.act_project_workflow_step(uuid,uuid,text,text,integer)') is not null
  or to_regprocedure('private.act_project_workflow_step(uuid,uuid,text,text,integer)') is not null then
  raise exception 'Only the idempotent workflow action signature may be called by authenticated users';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='workflow_events' and column_name='idempotency_key')
  or not exists(select 1 from pg_indexes where schemaname='public' and tablename='workflow_events' and indexname='workflow_events_idempotency_uq') then
  raise exception 'Workflow event idempotency key and unique index are required';
 end if;
 select pg_get_functiondef('private.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)'::regprocedure) into v_def;
 if position('private.add_business_days' in v_def)=0 or position('WORKFLOW_STEP_ASSIGNED' in v_def)=0 then
  raise exception 'Next workflow step must receive business-day SLA and activation notification';
 end if;
 select pg_get_functiondef('private.run_workflow_sla_sweep()'::regprocedure) into v_def;
 if position('private.count_business_days' in v_def)=0 or position('WORKFLOW_SLA_ESCALATION_' in v_def)=0 then
  raise exception 'SLA must repeat escalation every two overdue business days';
 end if;
 if exists(select 1 from public.project_permission_catalog where permission_code='document.sign' and requires_authority_check)
   or exists(select 1 from public.authority_catalog where authority_code='document.sign' and active) then
  raise exception 'document.sign must not require additional Authority under SSOT §5.2.1';
 end if;
 if to_regprocedure('public.revoke_project_signatory_appointment(uuid,text)') is null then
  raise exception 'Final Signatory revocation RPC missing';
 end if;
 select pg_get_functiondef('private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text)'::regprocedure) into v_def;
 if position('v_signatory_only' in v_def)=0 or position('Final Signatory-only membership is Company Membership only' in v_def)=0
  or position('document.sign' in v_def)>0 or position('already has a Company Membership' in v_def)=0 then
  raise exception 'RFIN-B must support safe Company-only Final Signatory onboarding and reject additive invitations for existing members';
 end if;
 select pg_get_functiondef('private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text)'::regprocedure) into v_def;
 if position('v_signatory_only' in v_def)=0 or position('Final Signatory-only membership is Company Membership only' in v_def)=0
  or position('document.sign' in v_def)>0 or position('user_active_persona_contexts' in v_def)=0 then
  raise exception 'Member access replacement must support signatory-only membership and clear stale Persona context';
 end if;
 select pg_get_functiondef('private.redeem_rfin(text)'::regprocedure) into v_def;
 if position('on conflict(company_id,user_id) do nothing' in v_def)=0
  or position('Company Membership already exists' in v_def)=0
  or position('on conflict(company_id,user_id) do update' in v_def)>0 then
  raise exception 'RFIN-B redemption must not append a new snapshot to an existing Company Membership';
 end if;
 select pg_get_functiondef('private.preview_rfin_redemption(text)'::regprocedure) into v_def;
 if position('signatory_only' in v_def)=0 or position('company_permissions' in v_def)=0 then
  raise exception 'RFIN-B preview must clearly identify Company-only Final Signatory invitations';
 end if;
 if position('authority_codes' in pg_get_functiondef('private.list_project_workflow_approvers(uuid)'::regprocedure))=0
  or position('company_membership_authority_assignments' in pg_get_functiondef('private.list_project_workflow_approvers(uuid)'::regprocedure))=0 then
  raise exception 'Workflow approver picker must expose active Authority assignments for step-level eligibility';
 end if;
 if to_regprocedure('public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text)') is null
  or not has_function_privilege('authenticated','public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text)','EXECUTE')
  or has_function_privilege('anon','public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text)','EXECUTE') then
  raise exception 'Server-side scoped document snapshot creation RPC must be authenticated-only';
 end if;
 if has_table_privilege('authenticated','public.documents','INSERT')
  or has_table_privilege('authenticated','public.documents','UPDATE')
  or has_table_privilege('authenticated','public.documents','DELETE') then
  raise exception 'Document snapshots must be immutable to direct authenticated table DML';
 end if;
 select pg_get_functiondef('public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text)'::regprocedure) into v_def;
 if position('private.has_project_permission' in v_def)=0 or position('cash_transactions' in v_def)=0
  or position('inventory_transactions' in v_def)=0 or position('boq_items' in v_def)=0
  or position('progress_logs' in v_def)=0 or position('safety_reports' in v_def)=0
  or position('content_sha256' in v_def)=0 or position('audit_logs' in v_def)=0 then
  raise exception 'Document snapshot RPC must enforce source permissions, lock and hash canonical records, and audit creation';
 end if;
 if to_regprocedure('public.list_my_final_signatory_documents()') is null then raise exception 'Appointment-scoped Final Signatory inbox RPC missing'; end if;
 if to_regprocedure('public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)') is null then
  raise exception 'Scoped procurement request RPC missing';
 end if;
 if to_regprocedure('public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid)') is null then
  raise exception 'Scoped Goods Receipt RPC missing';
 end if;
 select pg_get_functiondef('public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)'::regprocedure) into v_def;
 if position('idempotency_key' in v_def)=0 or position('request_hash' in v_def)=0
  or position('hashtextextended' in v_def)=0 or position('IDEMPOTENCY_KEY_REUSED' in v_def)=0 then
  raise exception 'Purchase Request creation must be payload-bound and idempotent';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='procurement_requests' and column_name='idempotency_key')
  or not exists(select 1 from pg_indexes where schemaname='public' and tablename='procurement_requests' and indexname='procurement_requests_idempotency_idx') then
  raise exception 'Purchase Request idempotency column and unique index missing';
 end if;
 select pg_get_functiondef('public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) into v_def;
 if position('v_rejected' in v_def)=0 or position('v_qty+v_rejected<=0' in v_def)=0
  or position('if v_qty>0 then' in v_def)=0 or position('goods_receipt_items' in v_def)=0
  or position('idempotency_key' in v_def)=0 or position('request_hash' in v_def)=0
  or position('hashtextextended' in v_def)=0 or position('IDEMPOTENCY_KEY_REUSED' in v_def)=0 then
  raise exception 'Goods Receipt must record accepted/rejected quantities, post only accepted stock and be safe to retry';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='goods_receipts' and column_name='idempotency_key')
  or not exists(select 1 from pg_indexes where schemaname='public' and tablename='goods_receipts' and indexname='goods_receipts_idempotency_idx') then
  raise exception 'Goods Receipt idempotency column and unique index missing';
 end if;
 select pg_get_functiondef('public.submit_procurement_request_scoped(uuid,uuid,uuid)'::regprocedure) into v_def;
 if position('v.status=''SUBMITTED'' then return' in v_def)=0 then raise exception 'Procurement submission retry must be idempotent'; end if;
 select pg_get_functiondef('public.issue_procurement_order_scoped(uuid,uuid,uuid,text)'::regprocedure) into v_def;
 if position('v.status=''ORDERED'' then' in v_def)=0 or position('where request_id=p_request_id' in v_def)=0 then
  raise exception 'Purchase Order issuance retry must return the existing order';
 end if;
 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('private.workflow_resource_snapshot' in v_def)=0 or position('resource_snapshot' in v_def)=0 then
  raise exception 'Workflow start must capture a server-derived immutable resource snapshot and hash';
 end if;
 select pg_get_functiondef('private.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)'::regprocedure) into v_def;
 if position('private.workflow_resource_snapshot' in v_def)=0 or position('STALE_VERSION' in v_def)=0 then
  raise exception 'Every workflow action must lock and revalidate the immutable resource snapshot';
 end if;
 select pg_get_functiondef('private.apply_workflow_resource_transition()'::regprocedure) into v_def;
 if position('private.workflow_resource_snapshot' in v_def)=0 or position('resource_version' in v_def)=0 then
  raise exception 'Workflow-owned resource status transitions must refresh the server resource hash';
 end if;
 if position('jsonb_array_elements' in v_def)=0 or position('step_order' in v_def)=0
  or position('boq.approve' in v_def)=0 or position('document.approve' in v_def)=0
  or position('procurement.approve' in v_def)=0 then
  raise exception 'Resource approval state must follow the final configured workflow step permission';
 end if;
 select pg_get_functiondef('private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text)'::regprocedure) into v_def;
 if position('project_memberships' in v_def)>0 or position('document.sign Project permission' in v_def)>0 then
  raise exception 'Final Signatory appointment must not require Project Membership or direct Project permission';
 end if;
 select pg_get_functiondef('private.issue_project_document_scoped(uuid,uuid,uuid,text)'::regprocedure) into v_def;
  if position('company_memberships' in v_def)=0 or position('project_signatory_appointments' in v_def)=0
   or position('private.has_company_member_permission' in v_def)>0 or position('document.sign' in v_def)>0
   or position('STALE_VERSION' in v_def)=0 or position('workflow_instances' in v_def)=0
   or position('has_project_authority' in v_def)>0 or position('has_project_permission' in v_def)>0 then
   raise exception 'Final signing must validate active Company Membership, explicit appointment, completed workflow and current resource hash without direct permission or extra Authority';
  end if;
 if has_table_privilege('authenticated','public.document_signatures','INSERT') then
  raise exception 'Final signatures must be inserted only through the atomic signing/issuance RPC';
 end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='document_signatures' and cmd='INSERT' and roles @> array['authenticated']::name[]) then
  raise exception 'Direct authenticated signature INSERT policy must not exist';
 end if;
 if not exists(select 1 from cron.job where jobname='udu-workflow-sla-sweep') then
  raise exception 'Workflow SLA scheduler job missing';
 end if;
 if not exists(select 1 from pg_trigger where tgname='workflow_resource_transition' and not tgisinternal) then
  raise exception 'Workflow resource lifecycle trigger missing';
 end if;

 if to_regprocedure('public.create_workflow_definition_steps_scoped(uuid,uuid,text,text,jsonb,integer,text,text)') is null then
  raise exception 'Multi-stage workflow definition RPC missing';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='workflow_steps' and column_name='display_name') then
  raise exception 'Workflow step display label column missing';
 end if;
 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('permission_code' in v_def)=0 or position('private.user_has_project_permission' in v_def)=0
  or position('required_role_codes' in v_def)=0 or position('workflow.step.act' in v_def)=0 then
  raise exception 'Each serial workflow step must independently validate its action permission, Role and active assignee';
 end if;
 select pg_get_functiondef('public.start_project_workflow_from_definition(uuid,uuid,uuid,text,uuid[],text,uuid)'::regprocedure) into v_def;
 if position('private.start_project_workflow_steps' in v_def)=0 or position('step_templates' in v_def)=0 or position('p_reason' in v_def)=0 then
  raise exception 'Workflow start must expand every configured step template into its own approver/action';
 end if;
 select pg_get_functiondef('private.act_project_workflow_step(uuid,uuid,text,text,integer,uuid)'::regprocedure) into v_def;
 if position('private.add_business_days' in v_def)=0 or position('due_at' in v_def)=0
  or position('IDEMPOTENCY_KEY_REUSED' in v_def)=0 then
  raise exception 'Each activated workflow step must inherit the business-day SLA and preserve idempotent action semantics';
 end if;

 if to_regprocedure('public.cancel_project_document_scoped(uuid,uuid,uuid,text,uuid)') is null
  or to_regprocedure('public.create_project_document_replacement_scoped(uuid,uuid,uuid,text,date,date,text,text,uuid)') is null then
  raise exception 'Document BATAL/GANTI RPCs are missing';
 end if;
 if to_regclass('public.document_lifecycle_events') is null then
  raise exception 'Immutable document lifecycle event table is missing';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='documents' and column_name='lifecycle_status')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='documents' and column_name='revision_number')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='documents' and column_name='replaced_by_document_id') then
  raise exception 'Document lifecycle and revision columns are incomplete';
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.documents'::regclass and tgname='documents_lifecycle_fields_guard' and not tgisinternal) then
  raise exception 'Document lifecycle direct-update guard is missing';
 end if;
 if not (select relrowsecurity from pg_class where oid='public.document_lifecycle_events'::regclass) then
  raise exception 'Document lifecycle event RLS is not enabled';
 end if;
 if has_table_privilege('authenticated','public.document_lifecycle_events','INSERT')
  or has_table_privilege('authenticated','public.document_lifecycle_events','UPDATE')
  or has_table_privilege('authenticated','public.document_lifecycle_events','DELETE') then
  raise exception 'Authenticated users must not mutate document lifecycle events directly';
 end if;
 select pg_get_functiondef('public.cancel_project_document_scoped(uuid,uuid,uuid,text,uuid)'::regprocedure) into v_def;
 if position('document.void' in v_def)=0 or position('private.has_project_authority' in v_def)=0
  or position('BATAL' in v_def)=0 or position('idempotency_key' in v_def)=0 then
  raise exception 'BATAL must require permission, Authority, reason and idempotency';
 end if;
 select pg_get_functiondef('public.create_project_document_replacement_scoped(uuid,uuid,uuid,text,date,date,text,text,uuid)'::regprocedure) into v_def;
 if position('document.replace' in v_def)=0 or position('private.has_project_authority' in v_def)=0
  or position('create_project_document_snapshot_scoped' in v_def)=0 or position('GANTI' in v_def)=0 then
  raise exception 'GANTI must create a fresh server snapshot and require Authority';
 end if;
 select pg_get_functiondef('private.issue_project_document_scoped(uuid,uuid,uuid,text)'::regprocedure) into v_def;
 if position('lifecycle_status' in v_def)=0 then
  raise exception 'BATAL/GANTI documents must not be issued or signed';
 end if;
 select pg_get_functiondef('private.verify_private_document_qr(uuid)'::regprocedure) into v_def;
 if position('is_valid' in pg_get_function_result('private.verify_private_document_qr(uuid)'::regprocedure))=0
  or position('lifecycle_status' in pg_get_function_result('private.verify_private_document_qr(uuid)'::regprocedure))=0
  or position('DOCUMENT_QR_VERIFY_INVALIDATED' in v_def)=0 or position('REVOKED' in v_def)=0 then
  raise exception 'QR verification must explicitly report invalidated BATAL/GANTI documents';
 end if;
 select pg_get_functiondef('public.list_my_final_signatory_documents()'::regprocedure) into v_def;
 if position('lifecycle_status' in v_def)=0 then
  raise exception 'Superseded or cancelled documents must not remain in Final Signatory inbox';
 end if;
 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('Only an active DRAFT document' in v_def)=0 then
  raise exception 'Only active DRAFT documents may start a new approval workflow';
 end if;

 select pg_get_functiondef('private.appoint_project_signatory(uuid,uuid,text,jsonb,timestamptz,timestamptz,text)'::regprocedure) into v_def;
 if position('private.is_company_super_admin' in v_def)=0 or position('membership_status=''ACTIVE''' in v_def)=0
  or position('pg_advisory_xact_lock' in v_def)=0 or position('document.sign' in v_def)>0
  or position('company_membership_id=p_membership_id and project_id' in v_def)>0 then
  raise exception 'Final Signatory appointment must be Company Super Admin + active same-tenant Company Membership, with one serialized appointment per Project/document type';
 end if;
  if position('employee_records' in v_def)>0 or position('company_membership_persona_assignments' in v_def)>0 or position('project_memberships' in v_def)>0 then
   raise exception 'Final Signatory appointment must not require Employee Record, Persona or Project Membership';
  end if;
 select pg_get_functiondef('private.issue_project_document_scoped(uuid,uuid,uuid,text)'::regprocedure) into v_def;
 if position('company_memberships' in v_def)=0 or position('project_signatory_appointments' in v_def)=0
  or position('document.sign' in v_def)>0 or position('has_company_member_permission' in v_def)>0
  or position('has_project_authority' in v_def)>0 or position('pg_advisory_xact_lock' in v_def)=0 then
  raise exception 'Final signing must rely on active Company Membership and explicit appointment, without direct permission or extra Authority';
 end if;
  if position('employee_records' in v_def)>0 or position('company_membership_persona_assignments' in v_def)>0 or position('project_memberships' in v_def)>0 then
   raise exception 'Final signing must not require Employee Record, Persona or Project Membership';
  end if;
 select pg_get_functiondef('public.list_my_final_signatory_documents()'::regprocedure) into v_def;
 if position('has_company_member_permission' in v_def)>0 or position('document.sign' in v_def)>0
  or position('project_signatory_appointments' in v_def)=0 then
  raise exception 'Final Signatory inbox must rely on Company Membership and explicit appointment only';
 end if;
  if position('employee_records' in v_def)>0 or position('company_membership_persona_assignments' in v_def)>0 or position('project_memberships' in v_def)>0 then
   raise exception 'Final Signatory inbox must not require Employee Record, Persona or Project Membership';
  end if;
 select pg_get_functiondef('private.issue_rfin_b_with_snapshot(uuid,text,jsonb,interval,text)'::regprocedure) into v_def;
 if position('Final Signatory-only membership is Company Membership only' in v_def)=0
  or position('document.sign' in v_def)>0 then
  raise exception 'RFIN-B must permit Company Membership-only Final Signatory snapshots without Role or document.sign';
 end if;
 select pg_get_functiondef('private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text)'::regprocedure) into v_def;
 if position('Final Signatory-only membership is Company Membership only' in v_def)=0
  or position('document.sign' in v_def)>0 then
  raise exception 'Company access replacement must permit Company Membership-only Final Signatory access';
 end if;

 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('private.workflow_resource_snapshot' in v_def)=0 or position('from public.cash_transactions' in v_def)=0
  or position('private.workflow_resource_snapshot' in v_def)>position('from public.cash_transactions' in v_def) then
  raise exception 'Workflow must lock and snapshot the resource before reading authority amount/category facts';
 end if;
 select pg_get_functiondef('public.create_project_document_snapshot_scoped(uuid,uuid,text,text,date,date,text)'::regprocedure) into v_def;
 if position('LAPORAN_PROGRES' in v_def)=0 or position('LAPORAN_PROGRES_IMK' in v_def)=0 then
  raise exception 'Document snapshot builder must support generic progress reports and legacy IMK documents';
 end if;
 select pg_get_functiondef('public.import_project_backup_scoped(uuid,uuid,jsonb,text)'::regprocedure) into v_def;
 if position('workspace_id' in v_def)=0 or position('project_id' in v_def)=0 or position('v_project.name' in v_def)=0 then
  raise exception 'Backup import must validate exact Workspace/Project scope and active Project identity';
 end if;


 select pg_get_functiondef('private.revoke_project_signatory_appointment(uuid,text)'::regprocedure) into v_def;
 if position('pg_advisory_xact_lock' in v_def)=0 or position('ends_at=least' in v_def)>0 then
  raise exception 'Signatory revocation must serialize with signing and must not create invalid future appointment periods';
 end if;
 select pg_get_functiondef('private.start_project_workflow_steps(uuid,text,text,uuid,text,jsonb,integer,text,uuid,integer,text,uuid)'::regprocedure) into v_def;
 if position('p_reason' in v_def)=0 or position('snapshot' in v_def)=0 or position('IDEMPOTENCY_KEY_REUSED' in v_def)=0 then
  raise exception 'Workflow initiation reason must be mandatory, audited and included in idempotency';
 end if;
 select pg_get_functiondef('public.create_workflow_definition_steps_scoped(uuid,uuid,text,text,jsonb,integer,text,text)'::regprocedure) into v_def;
 if position('p_sla_business_days is null' in v_def)=0 then
  raise exception 'Workflow definition SLA must reject NULL values';
 end if;

 if position('is_company_super_admin boolean' in pg_get_function_result('private.list_company_members_for_console(uuid)'::regprocedure))=0
  or position('is_company_super_admin boolean' in pg_get_function_result('public.list_company_members_for_console(uuid)'::regprocedure))=0 then
  raise exception 'Company member console RPCs must expose the protected super-admin flag consistently';
 end if;
 select pg_get_functiondef('public.list_company_members_for_console(uuid)'::regprocedure) into v_def;
 if (select prosecdef from pg_proc where oid='public.list_company_members_for_console(uuid)'::regprocedure)
  or position('private.list_company_members_for_console' in v_def)=0 then
  raise exception 'Public Company Console RPC must remain an invoker wrapper over the private guarded implementation';
 end if;

 select pg_get_functiondef('private.replace_company_member_access(uuid,text[],text[],jsonb,jsonb,text)'::regprocedure) into v_def;
 if position('Authority scope, amount and currency are invalid' in v_def)=0
  or position('max_amount' in v_def)=0
  or position('scope' in v_def)=0 then
  raise exception 'Company member access replacement must validate Authority scope and monetary limits';
 end if;
 
 select pg_get_functiondef('public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)'::regprocedure) into v_def;
 if position('Supplier, currency, needed date, notes or request items are invalid' in v_def)=0
  or position('jsonb_array_length(p_items)>100' in v_def)=0
  or position('^[A-Z]{3}$' in v_def)=0
  or position('length(trim(p_supplier_name))>160' in v_def)>0 then
  raise exception 'Procurement request RPC must validate supplier, currency, notes and bounded item array exactly once';
 end if;


 select pg_get_functiondef('public.resolve_my_active_context()'::regprocedure) into v_def;
 if position('active_persona_code' in v_def)=0
  or position('company_membership_persona_assignments' in v_def)=0
  or position('project_membership_permissions' in v_def)=0 then
  raise exception 'Active context resolver must expose only assigned Persona and scoped Project permissions';
 end if;

 if position('authority_codes text[]' in pg_get_function_result('public.list_project_workflow_approvers(uuid)'::regprocedure))=0
  or position('authority_codes text[]' in pg_get_function_result('private.list_project_workflow_approvers(uuid)'::regprocedure))=0 then
  raise exception 'Workflow approver public/private RPC result contracts must match the Authority codes array used by the client';
 end if;

 if to_regprocedure('public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb)') is not null
  or to_regprocedure('public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb)') is not null
  or not has_function_privilege('authenticated','public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','public.create_procurement_request_scoped(uuid,uuid,text,text,date,text,jsonb,uuid)','EXECUTE')
  or not has_function_privilege('authenticated','public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','public.receive_procurement_order_scoped(uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE') then
  raise exception 'Idempotent Procurement RPC signatures and authenticated-only grants must match';
 end if;
end $$;

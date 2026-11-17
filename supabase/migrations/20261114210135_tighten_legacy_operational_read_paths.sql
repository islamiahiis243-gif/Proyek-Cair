-- Remove broad global permissive SELECT policies on legacy operational ledgers.
-- Legacy unscoped rows remain restricted to the existing legacy role allowlists.
-- New scoped rows require the corresponding explicit project read permission.
drop policy if exists boq_items_read_authenticated on public.boq_items;
create policy boq_items_read_legacy_role on public.boq_items for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','storekeeper','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'boq.read')));

drop policy if exists boq_sections_read_authenticated on public.boq_sections;
create policy boq_sections_read_legacy_role on public.boq_sections for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','storekeeper','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'boq.read')));

drop policy if exists boq_additions_read on public.boq_additions;
create policy boq_additions_read_legacy_role on public.boq_additions for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','storekeeper','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'boq.read')));

drop policy if exists inventory_read_authenticated on public.inventory_transactions;
create policy inventory_read_legacy_role on public.inventory_transactions for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','storekeeper','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'inventory.read')));

drop policy if exists inventory_reversals_read on public.inventory_transaction_reversals;
create policy inventory_reversals_read_legacy_role on public.inventory_transaction_reversals for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','storekeeper','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'inventory.read')));

drop policy if exists cash_read_authorized on public.cash_transactions;
create policy cash_read_legacy_role on public.cash_transactions for select to authenticated
 using ((workspace_id is null and project_id is null and public.current_user_role() in ('admin','site_manager','finance','auditor'))
 or (workspace_id is not null and project_id is not null and private.has_project_permission(project_id,'cash.read')));

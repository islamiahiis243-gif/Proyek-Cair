-- Add indexes for the observed high-traffic Project and Workspace query paths.
-- These indexes also cover the corresponding foreign-key columns as leading keys.
-- No data, constraints, permissions, or RLS policies are changed.

create index if not exists audit_logs_workspace_created_at_idx
  on public.audit_logs (workspace_id, created_at desc);

create index if not exists boq_items_workspace_project_active_source_idx
  on public.boq_items (workspace_id, project_id, is_active, source_row);

create index if not exists boq_items_parent_section_idx
  on public.boq_items (parent_section_id);

create index if not exists boq_sections_workspace_project_active_sort_idx
  on public.boq_sections (workspace_id, project_id, is_active, sort_order);

create index if not exists boq_sections_parent_idx
  on public.boq_sections (parent_id);

create index if not exists inventory_transactions_workspace_project_occurred_idx
  on public.inventory_transactions (workspace_id, project_id, occurred_at, created_at);

create index if not exists cash_transactions_workspace_project_occurred_idx
  on public.cash_transactions (workspace_id, project_id, occurred_at, created_at);

-- Read-only regression for 20261116055034.
do $$
declare
  v_name text;
  v_actual text;
  v_valid boolean;
  v_ready boolean;
  v_indexes text[] := array[
    'audit_logs_workspace_created_at_idx',
    'boq_items_workspace_project_active_source_idx',
    'boq_items_parent_section_idx',
    'boq_sections_workspace_project_active_sort_idx',
    'boq_sections_parent_idx',
    'inventory_transactions_workspace_project_occurred_idx',
    'cash_transactions_workspace_project_occurred_idx'
  ];
begin
  foreach v_name in array v_indexes loop
    select i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
      into v_valid, v_ready, v_actual
    from pg_index i
    join pg_class c on c.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_name;

    if v_actual is null then
      raise exception 'Expected index is missing: %', v_name;
    end if;
    if not v_valid or not v_ready then
      raise exception 'Index is not valid/ready: %', v_name;
    end if;
  end loop;

  select pg_get_indexdef(i.indexrelid) into v_actual
  from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='audit_logs_workspace_created_at_idx';
  if position('(workspace_id, created_at DESC)' in v_actual)=0 then
    raise exception 'Audit workspace/time index has unexpected key order';
  end if;

  select pg_get_indexdef(i.indexrelid) into v_actual
  from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='boq_items_workspace_project_active_source_idx';
  if position('(workspace_id, project_id, is_active, source_row)' in v_actual)=0 then
    raise exception 'BOQ items scope/order index has unexpected key order';
  end if;

  select pg_get_indexdef(i.indexrelid) into v_actual
  from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='boq_sections_workspace_project_active_sort_idx';
  if position('(workspace_id, project_id, is_active, sort_order)' in v_actual)=0 then
    raise exception 'BOQ sections scope/order index has unexpected key order';
  end if;

  select pg_get_indexdef(i.indexrelid) into v_actual
  from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='inventory_transactions_workspace_project_occurred_idx';
  if position('(workspace_id, project_id, occurred_at, created_at)' in v_actual)=0 then
    raise exception 'Inventory ledger scope/time index has unexpected key order';
  end if;

  select pg_get_indexdef(i.indexrelid) into v_actual
  from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='cash_transactions_workspace_project_occurred_idx';
  if position('(workspace_id, project_id, occurred_at, created_at)' in v_actual)=0 then
    raise exception 'Cash ledger scope/time index has unexpected key order';
  end if;
end
$$;

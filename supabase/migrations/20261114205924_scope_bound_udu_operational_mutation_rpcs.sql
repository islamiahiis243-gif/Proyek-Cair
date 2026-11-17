-- Project-scoped operational mutation RPC entry points.
-- Requires real canonical workspace/project rows before any write can pass.

create or replace function public.create_boq_addition_scoped(
 p_workspace_id uuid, p_project_id uuid, p_item_id uuid, p_description text,
 p_quantity numeric, p_uom text, p_unit_rate numeric, p_requester_type text,
 p_reason text, p_requested_by_name text, p_approval_reference text default null,
 p_notes text default null, p_is_stock_item boolean default true,
 p_owner_type text default 'KONTRAKTOR'
) returns public.boq_additions
language plpgsql security definer set search_path=''
as $function$
declare v_item public.boq_items%rowtype; v_code text; v_result public.boq_additions%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or p_project_id is null then raise exception 'Active workspace and project are required' using errcode='22023'; end if;
 if not private.has_project_permission(p_project_id,'boq.addition.create') then raise exception 'Missing project permission: boq.addition.create' using errcode='42501'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id) then raise exception 'Project does not belong to the selected workspace' using errcode='22023'; end if;
 if p_item_id is null then raise exception 'A canonical project-scoped BOQ item is required; implicit BOQ item creation is disabled' using errcode='22023'; end if;
 if p_quantity is null or p_quantity<=0 or p_unit_rate is null or p_unit_rate<0 then raise exception 'Quantity and rate are invalid' using errcode='22023'; end if;
 if coalesce(trim(p_uom),'')='' or coalesce(trim(p_reason),'')='' or coalesce(trim(p_requested_by_name),'')='' then raise exception 'UOM, reason and requester are required' using errcode='22023'; end if;
 if p_requester_type not in ('CLIENT','CONTRACTOR') then raise exception 'Invalid requester type' using errcode='22023'; end if;
 if p_owner_type not in ('KONTRAKTOR','IMK') then raise exception 'Invalid item ownership' using errcode='22023'; end if;
 select * into v_item from public.boq_items i where i.id=p_item_id and i.workspace_id=p_workspace_id and i.project_id=p_project_id and i.is_active for update;
 if not found then raise exception 'BOQ item is not in the active project or is inactive' using errcode='42501'; end if;
 v_code:='ADD-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6));
 insert into public.boq_additions(addition_code,item_id,description,quantity,uom,unit_rate,requester_type,chargeable_to_client,reason,requested_by_name,approval_reference,notes,created_by,billing_status,workspace_id,project_id)
 values(v_code,v_item.id,coalesce(nullif(trim(p_description),''),v_item.description),p_quantity,trim(p_uom),p_unit_rate,p_requester_type,p_requester_type='CLIENT',trim(p_reason),trim(p_requested_by_name),nullif(trim(p_approval_reference),''),nullif(trim(p_notes),''),(select auth.uid()),case when p_requester_type='CLIENT' then 'BELUM_DITAGIHKAN' else 'TIDAK_DITAGIHKAN' end,p_workspace_id,p_project_id)
 returning * into v_result;
 -- Audit trigger records the full row snapshot and canonical scope.
 return v_result;
end
$function$;

create or replace function public.record_cash_mutation_scoped(
 p_workspace_id uuid,p_project_id uuid,p_idempotency_key uuid,p_type text,p_amount numeric,
 p_occurred_at timestamptz default now(),p_category text default null,p_description text default null,
 p_reference_no text default null,p_pic text default null,p_notes text default null
) returns public.cash_transactions
language plpgsql security definer set search_path=''
as $function$
declare v_balance numeric(18,2); v_result public.cash_transactions%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or p_project_id is null then raise exception 'Active workspace and project are required' using errcode='22023'; end if;
 if not private.has_project_permission(p_project_id,'cash.transaction.create') then raise exception 'Missing project permission: cash.transaction.create' using errcode='42501'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id) then raise exception 'Project does not belong to the selected workspace' using errcode='22023'; end if;
 if p_idempotency_key is null then raise exception 'Idempotency key is required' using errcode='22023'; end if;
 if p_type not in ('MASUK','KELUAR') then raise exception 'Invalid cash transaction type' using errcode='22023'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than zero' using errcode='22023'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Description is required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,824631905177));
 select * into v_result from public.cash_transactions c where c.idempotency_key=p_idempotency_key;
 if found then
   if v_result.workspace_id is distinct from p_workspace_id or v_result.project_id is distinct from p_project_id or v_result.created_by is distinct from (select auth.uid()) then
     raise exception 'Idempotency key is already used outside this actor/project context' using errcode='23505';
   end if;
   return v_result;
 end if;
 select coalesce(sum(case when c.transaction_type='MASUK' then c.amount else -c.amount end),0) into v_balance
 from public.cash_transactions c where c.workspace_id=p_workspace_id and c.project_id=p_project_id;
 if p_type='KELUAR' and v_balance<p_amount then raise exception 'Insufficient project cash balance: %',v_balance using errcode='23514'; end if;
 insert into public.cash_transactions(idempotency_key,transaction_type,amount,occurred_at,category,description,reference_no,pic,notes,created_by,workspace_id,project_id)
 values(p_idempotency_key,p_type,p_amount,coalesce(p_occurred_at,now()),p_category,trim(p_description),p_reference_no,p_pic,p_notes,(select auth.uid()),p_workspace_id,p_project_id)
 returning * into v_result;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values((select auth.uid()),'CASH_MUTATION','cash_transaction',v_result.id::text,jsonb_build_object('type',p_type,'amount',p_amount,'category',p_category),p_workspace_id,p_project_id);
 return v_result;
end
$function$;

create or replace function public.record_inventory_mutation_scoped(
 p_workspace_id uuid,p_project_id uuid,p_idempotency_key uuid,p_item_id uuid,p_type text,p_quantity numeric,
 p_occurred_at timestamptz default now(),p_reference_no text default null,p_counterparty text default null,
 p_location text default null,p_notes text default null,p_source_name text default null,
 p_destination_name text default null,p_recipient_name text default null,p_owner_type text default 'KONTRAKTOR',
 p_purpose text default null,p_addition_id uuid default null
) returns public.inventory_transactions
language plpgsql security definer set search_path=''
as $function$
declare v_item public.boq_items%rowtype; v_balance numeric(18,4); v_result public.inventory_transactions%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or p_project_id is null then raise exception 'Active workspace and project are required' using errcode='22023'; end if;
 if not private.has_project_permission(p_project_id,'inventory.movement.create') then raise exception 'Missing project permission: inventory.movement.create' using errcode='42501'; end if;
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id) then raise exception 'Project does not belong to the selected workspace' using errcode='22023'; end if;
 if p_idempotency_key is null then raise exception 'Idempotency key is required' using errcode='22023'; end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'Quantity must be greater than zero' using errcode='22023'; end if;
 if p_type not in ('MASUK','KELUAR','PENYESUAIAN_MASUK','PENYESUAIAN_KELUAR') then raise exception 'Invalid transaction type' using errcode='22023'; end if;
 if p_owner_type not in ('KONTRAKTOR','IMK') then raise exception 'Invalid material owner' using errcode='22023'; end if;
 if coalesce(trim(p_source_name),'')='' or coalesce(trim(p_destination_name),'')='' or coalesce(trim(p_counterparty),'')='' then raise exception 'Source, destination and counterparty are required' using errcode='22023'; end if;
 if p_addition_id is not null and not exists(select 1 from public.boq_additions a where a.id=p_addition_id and a.item_id=p_item_id and a.workspace_id=p_workspace_id and a.project_id=p_project_id) then
   raise exception 'BOQ addition does not belong to the selected project item' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_item_id::text||':'||p_owner_type,824631905177));
 select * into v_result from public.inventory_transactions t where t.idempotency_key=p_idempotency_key;
 if found then
   if v_result.workspace_id is distinct from p_workspace_id or v_result.project_id is distinct from p_project_id or v_result.created_by is distinct from (select auth.uid()) then
     raise exception 'Idempotency key is already used outside this actor/project context' using errcode='23505';
   end if;
   return v_result;
 end if;
 select * into v_item from public.boq_items i where i.id=p_item_id and i.workspace_id=p_workspace_id and i.project_id=p_project_id and i.is_active and i.is_stock_item for update;
 if not found then raise exception 'BOQ stock item is not in the active project' using errcode='42501'; end if;
 select coalesce(sum(case when t.transaction_type in ('MASUK','PENYESUAIAN_MASUK') then t.quantity else -t.quantity end),0) into v_balance
 from public.inventory_transactions t where t.item_id=p_item_id and t.workspace_id=p_workspace_id and t.project_id=p_project_id and t.owner_type=p_owner_type;
 if p_type in ('KELUAR','PENYESUAIAN_KELUAR') and v_balance<p_quantity then raise exception 'Insufficient project stock. Current balance: % %',v_balance,v_item.uom using errcode='23514'; end if;
 insert into public.inventory_transactions(idempotency_key,item_id,transaction_type,quantity,uom,occurred_at,reference_no,counterparty,location,notes,created_by,source_name,destination_name,recipient_name,owner_type,purpose,addition_id,workspace_id,project_id)
 values(p_idempotency_key,p_item_id,p_type,p_quantity,v_item.uom,coalesce(p_occurred_at,now()),p_reference_no,p_counterparty,p_location,p_notes,(select auth.uid()),p_source_name,p_destination_name,p_recipient_name,p_owner_type,p_purpose,p_addition_id,p_workspace_id,p_project_id)
 returning * into v_result;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values((select auth.uid()),'INVENTORY_MUTATION','inventory_transaction',v_result.id::text,jsonb_build_object('item_id',p_item_id,'type',p_type,'quantity',p_quantity,'uom',v_item.uom,'owner_type',p_owner_type,'source',p_source_name,'destination',p_destination_name,'addition_id',p_addition_id),p_workspace_id,p_project_id);
 return v_result;
end
$function$;

create or replace function public.reverse_inventory_transaction_scoped(
 p_workspace_id uuid,p_project_id uuid,p_transaction_id uuid,p_reason text,p_idempotency_key uuid
) returns public.inventory_transactions
language plpgsql security definer set search_path=''
as $function$
declare v_original public.inventory_transactions%rowtype; v_reverse public.inventory_transactions%rowtype; v_type text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_workspace_id is null or p_project_id is null then raise exception 'Active workspace and project are required' using errcode='22023'; end if;
 if not private.has_project_permission(p_project_id,'inventory.movement.reverse') then raise exception 'Missing project permission: inventory.movement.reverse' using errcode='42501'; end if;
 select * into v_original from public.inventory_transactions t where t.id=p_transaction_id and t.workspace_id=p_workspace_id and t.project_id=p_project_id for update;
 if not found then raise exception 'Transaction not found in the active project' using errcode='42501'; end if;
 if coalesce(trim(p_reason),'')='' then raise exception 'Correction reason is required' using errcode='22023'; end if;
 if exists(select 1 from public.inventory_transaction_reversals r where r.original_transaction_id=p_transaction_id) then raise exception 'Transaction has already been reversed' using errcode='23505'; end if;
 v_type:=case v_original.transaction_type when 'MASUK' then 'PENYESUAIAN_KELUAR' when 'KELUAR' then 'PENYESUAIAN_MASUK' when 'PENYESUAIAN_MASUK' then 'PENYESUAIAN_KELUAR' else 'PENYESUAIAN_MASUK' end;
 select * into v_reverse from public.record_inventory_mutation_scoped(
  p_workspace_id,p_project_id,p_idempotency_key,v_original.item_id,v_type,v_original.quantity,now(),
  'REV-'||coalesce(v_original.reference_no,v_original.id::text),'Koreksi transaksi',v_original.location,trim(p_reason),
  coalesce(v_original.destination_name,'Lokasi proyek'),coalesce(v_original.source_name,'Lokasi asal'),
  'Koreksi oleh pengguna',v_original.owner_type,'Pembalikan transaksi '||v_original.id,v_original.addition_id
 );
 insert into public.inventory_transaction_reversals(original_transaction_id,reversal_transaction_id,reason,reversed_by,workspace_id,project_id)
 values(v_original.id,v_reverse.id,trim(p_reason),(select auth.uid()),p_workspace_id,p_project_id);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values((select auth.uid()),'INVENTORY_REVERSAL','inventory_transaction',v_original.id::text,
  jsonb_build_object('original_transaction_id',v_original.id,'reversal_transaction_id',v_reverse.id,'reason',trim(p_reason)),
  p_workspace_id,p_project_id);
 return v_reverse;
end
$function$;

revoke execute on function public.create_boq_addition(uuid,text,numeric,text,numeric,text,text,text,text,text,boolean,text) from public,anon,authenticated;
revoke execute on function public.record_cash_mutation(uuid,text,numeric,timestamptz,text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.record_inventory_mutation(uuid,uuid,text,numeric,timestamptz,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.record_inventory_mutation_v2(uuid,uuid,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.reverse_inventory_transaction(uuid,text,uuid) from public,anon,authenticated;

revoke all on function public.create_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text,boolean,text) from public,anon;
revoke all on function public.record_cash_mutation_scoped(uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text) from public,anon;
revoke all on function public.record_inventory_mutation_scoped(uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,uuid) from public,anon;
revoke all on function public.reverse_inventory_transaction_scoped(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.create_boq_addition_scoped(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.record_cash_mutation_scoped(uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text) to authenticated;
grant execute on function public.record_inventory_mutation_scoped(uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.reverse_inventory_transaction_scoped(uuid,uuid,uuid,text,uuid) to authenticated;

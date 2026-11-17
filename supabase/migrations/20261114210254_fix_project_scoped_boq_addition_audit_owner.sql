-- Correct the scoped BOQ addition routine after the first production definition.
-- The attached audit trigger writes the full event once; the function does not
-- insert a duplicate audit row. Ownership remains the BOQ item's commercial tag.
create or replace function public.create_boq_addition_scoped(
 p_workspace_id uuid,p_project_id uuid,p_item_id uuid,p_description text,p_quantity numeric,
 p_uom text,p_unit_rate numeric,p_requester_type text,p_reason text,p_requested_by_name text,
 p_approval_reference text default null,p_notes text default null,p_is_stock_item boolean default true,
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
 return v_result;
end
$function$;

-- Harden the row-audit trigger and persist the same canonical workspace/project scope.
create or replace function public.capture_udu_audit()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
 v_actor uuid; v_actor_name text; v_old jsonb; v_new jsonb; v_id text;
 v_workspace_id uuid; v_project_id uuid;
begin
 v_actor := (select auth.uid());
 select p.full_name into v_actor_name from public.profiles p where p.id=v_actor;
 if tg_op='DELETE' then
   v_old:=to_jsonb(old); v_new:=null; v_id:=coalesce(v_old->>'id',v_old->>'item_id',v_old->>'addition_code');
   v_workspace_id:=nullif(v_old->>'workspace_id','')::uuid; v_project_id:=nullif(v_old->>'project_id','')::uuid;
 elsif tg_op='UPDATE' then
   v_old:=to_jsonb(old); v_new:=to_jsonb(new); v_id:=coalesce(v_new->>'id',v_new->>'item_id',v_new->>'addition_code');
   v_workspace_id:=nullif(v_new->>'workspace_id','')::uuid; v_project_id:=nullif(v_new->>'project_id','')::uuid;
 else
   v_old:=null; v_new:=to_jsonb(new); v_id:=coalesce(v_new->>'id',v_new->>'item_id',v_new->>'addition_code');
   v_workspace_id:=nullif(v_new->>'workspace_id','')::uuid; v_project_id:=nullif(v_new->>'project_id','')::uuid;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,workspace_id,project_id)
 values(v_actor,'ROW_'||tg_op,tg_table_name,v_id,jsonb_build_object('actor_name',coalesce(v_actor_name,'Unknown / system'),'before',v_old,'after',v_new,'table',tg_table_name,'db_user',session_user),v_workspace_id,v_project_id);
 if tg_op='DELETE' then return old; else return new; end if;
end
$function$;

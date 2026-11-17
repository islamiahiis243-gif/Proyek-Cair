-- Read-only regression for Project backup permission catalog contracts.
do $$
declare
  v_missing text[];
  v_definition text;
begin
  select array_agg(expected.permission_code order by expected.permission_code)
    into v_missing
  from (values ('data.import'),('data.export')) expected(permission_code)
  where not exists (
    select 1 from public.project_permission_catalog p
    where p.permission_code=expected.permission_code
      and p.module='data'
      and p.action=split_part(expected.permission_code,'.',2)
      and p.risk_level='HIGH'
      and not p.requires_authority_check
      and p.active
  );
  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception 'Missing or invalid Project backup permission catalog entries: %',array_to_string(v_missing,', ');
  end if;

  select pg_get_functiondef('public.import_project_backup_scoped(uuid,uuid,jsonb,text)'::regprocedure)
    into v_definition;
  if position('data.import' in coalesce(v_definition,''))=0
     or position('progress.create' in coalesce(v_definition,''))=0
     or position('k3.report.create' in coalesce(v_definition,''))=0
     or position('personnel.roster.manage' in coalesce(v_definition,''))=0 then
    raise exception 'Backup import RPC must retain its global import gate and per-dataset permission checks';
  end if;

  -- Catalog registration must not silently approve any Role-Permission mapping.
  if exists (
    select 1 from public.role_permission_catalog
    where permission_code in ('data.import','data.export')
      and active
      and (approved_by is null or approved_at is null)
  ) then
    raise exception 'Unapproved backup Role-Permission mapping detected';
  end if;
end $$;

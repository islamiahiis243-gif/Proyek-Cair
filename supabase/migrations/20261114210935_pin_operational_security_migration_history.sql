-- Assert that the live Production operational-security migrations are present.
do $$
begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261114205924' and name='scope_bound_udu_operational_mutation_rpcs') then raise exception 'Missing scoped operational RPC migration'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261114210135' and name='tighten_legacy_operational_read_paths') then raise exception 'Missing tightened operational read policy migration'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261114210155' and name='restore_project_scope_audit_capture') then raise exception 'Missing project-scoped audit trigger migration'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261114210254' and name='fix_project_scoped_boq_addition_audit_owner') then raise exception 'Missing BOQ audit owner correction migration'; end if;
end $$;

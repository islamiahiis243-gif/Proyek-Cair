-- Confirm migration name assertions remain true without changing data or schema.
do $$
begin
 if (select count(*) from supabase_migrations.schema_migrations where version in ('20261114205924','20261114210135','20261114210155','20261114210254')) <> 4 then
  raise exception 'Operational security migration ledger baseline is incomplete';
 end if;
end $$;

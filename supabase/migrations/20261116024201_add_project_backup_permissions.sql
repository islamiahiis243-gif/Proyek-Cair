-- Add the already-implemented, Project-scoped backup permission contracts.
-- These catalog entries do not grant access; a Company Super Admin must explicitly
-- assign them to an active Company Member through the guarded access-assignment RPC.
insert into public.project_permission_catalog
  (permission_code,module,action,risk_level,requires_authority_check,active,description)
values
  ('data.import','data','import','HIGH',false,true,
   'Import the supported Project backup datasets through the scoped, audited merge RPC'),
  ('data.export','data','export','HIGH',false,true,
   'Export only Project datasets for which the actor independently has the matching read permission')
on conflict (permission_code) do update
set module=excluded.module,
    action=excluded.action,
    risk_level=excluded.risk_level,
    requires_authority_check=excluded.requires_authority_check,
    active=true,
    description=excluded.description;

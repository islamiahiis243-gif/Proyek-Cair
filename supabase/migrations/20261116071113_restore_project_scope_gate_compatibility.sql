-- Restore the documented legacy-compatible behavior of the project-scope gate.
-- The gate is intentionally OFF until canonical project mapping and cutover tests pass.
-- When OFF, existing legacy policies remain authoritative. When ON, missing scope
-- and missing permission are denied by the restrictive project-scope policies.
create or replace function private.project_scope_guard(
  p_project_id uuid,
  p_permission_code text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.operational_project_scope_enabled() then
    return true;
  end if;

  if p_project_id is null or p_permission_code is null then
    return false;
  end if;

  return private.has_project_permission(p_project_id, p_permission_code);
end
$$;

revoke all on function private.project_scope_guard(uuid, text) from public, anon;
grant execute on function private.project_scope_guard(uuid, text) to authenticated;

-- Restore the normative authorization contract: the restrictive project-scope
-- guard always requires an explicit Project and permission, regardless of rollout
-- gate state. Legacy compatibility must never be implemented as an authz bypass.
create or replace function private.project_scope_guard(p_project_id uuid, p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null
    and p_permission_code is not null
    and private.has_project_permission(p_project_id, p_permission_code)
$$;

revoke all on function private.project_scope_guard(uuid, text) from public, anon;
grant execute on function private.project_scope_guard(uuid, text) to authenticated;

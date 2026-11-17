-- Allow the verified Platform Owner to inspect global project registry metadata.
-- This is metadata-only SELECT; operational rows remain protected by project scope policies.
drop policy if exists projects_platform_admin_read on public.projects;
create policy projects_platform_admin_read on public.projects
for select to authenticated using (private.is_platform_super_admin());

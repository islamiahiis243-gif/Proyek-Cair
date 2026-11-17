-- Company profile change requests contain identity-change metadata; restrict reads to tenant admin and Platform Super Admin.
drop policy if exists company_profile_change_requests_read on public.company_profile_change_requests;
create policy company_profile_change_requests_read on public.company_profile_change_requests
for select to authenticated
using (private.is_platform_super_admin() or private.is_company_super_admin(workspace_id));

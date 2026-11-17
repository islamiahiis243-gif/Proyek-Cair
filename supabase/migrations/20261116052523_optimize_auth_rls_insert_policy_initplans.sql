-- Optimize caller identity checks in two authenticated INSERT policies.
-- The expression is semantically identical but is evaluated once per statement.
drop policy if exists media_insert_authenticated on public.project_media;
create policy media_insert_authenticated
  on public.project_media
  for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

drop policy if exists transaction_attachments_insert_auth on public.transaction_attachments;
create policy transaction_attachments_insert_auth
  on public.transaction_attachments
  for insert
  to authenticated
  with check ((select auth.uid()) = uploaded_by);

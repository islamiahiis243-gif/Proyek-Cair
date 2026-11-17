-- Read-only regression for 20261116052523.
do $$
declare
  v_media text;
  v_attachment text;
begin
  select with_check into v_media
  from pg_policies
  where schemaname='public' and tablename='project_media'
    and policyname='media_insert_authenticated' and cmd='INSERT'
    and 'authenticated'=any(roles) and permissive='PERMISSIVE';
  if v_media is null or position('SELECT AUTH.UID()' in upper(v_media))=0
    or position('CREATED_BY' in upper(v_media))=0 then
    raise exception 'project_media owner check is not statement-cached auth.uid()';
  end if;

  select with_check into v_attachment
  from pg_policies
  where schemaname='public' and tablename='transaction_attachments'
    and policyname='transaction_attachments_insert_auth' and cmd='INSERT'
    and 'authenticated'=any(roles) and permissive='PERMISSIVE';
  if v_attachment is null or position('SELECT AUTH.UID()' in upper(v_attachment))=0
    or position('UPLOADED_BY' in upper(v_attachment))=0 then
    raise exception 'transaction_attachments owner check is not statement-cached auth.uid()';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='project_media'
      and policyname='project_media_project_scope_insert_guard'
      and cmd='INSERT' and permissive='RESTRICTIVE'
      and 'authenticated'=any(roles)
      and position('project_scope_guard' in coalesce(with_check,''))>0
  ) then
    raise exception 'project_media restrictive Project-scope guard is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='transaction_attachments'
      and policyname='transaction_attachments_project_scope_insert_guard'
      and cmd='INSERT' and permissive='RESTRICTIVE'
      and 'authenticated'=any(roles)
      and position('attachment_project_scope_guard' in coalesce(with_check,''))>0
  ) then
    raise exception 'transaction_attachments restrictive Project-scope guard is missing';
  end if;
end
$$;

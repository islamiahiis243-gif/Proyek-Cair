-- Offline idempotency and transaction evidence linkage.
-- idempotency_key is already defined by the initial ledger foundation migration;
-- this migration adds evidence-path metadata and scoped attachment records.
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS attachment_path text;
ALTER TABLE public.cash_transactions ADD COLUMN IF NOT EXISTS attachment_path text;
create table if not exists public.transaction_attachments (
 id uuid primary key default gen_random_uuid(), transaction_kind text not null check(transaction_kind in ('INVENTORY','CASH')),
 transaction_id uuid not null, storage_path text not null, file_name text not null, mime_type text not null,
 uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.transaction_attachments enable row level security;
drop policy if exists transaction_attachments_read_auth on public.transaction_attachments;
create policy transaction_attachments_read_auth on public.transaction_attachments for select to authenticated using(true);
drop policy if exists transaction_attachments_insert_auth on public.transaction_attachments;
create policy transaction_attachments_insert_auth on public.transaction_attachments for insert to authenticated with check(auth.uid()=uploaded_by);
grant select,insert on public.transaction_attachments to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-evidence','project-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists project_evidence_read_auth on storage.objects;
create policy project_evidence_read_auth on storage.objects for select to authenticated using(bucket_id='project-evidence');
drop policy if exists project_evidence_insert_auth on storage.objects;
create policy project_evidence_insert_auth on storage.objects for insert to authenticated with check(bucket_id='project-evidence');
drop policy if exists project_evidence_delete_admin on storage.objects;
create policy project_evidence_delete_admin on storage.objects for delete to authenticated using(bucket_id='project-evidence' and public.current_user_role()='admin');

-- Ensure request readers can see only the masked NPWP suffix, never encrypted payload or fingerprint.
revoke all on public.company_profile_change_requests from public,anon,authenticated;
grant select (id,company_id,workspace_id,requested_by,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,reviewed_by,reviewed_at,review_notes,created_at)
on public.company_profile_change_requests to authenticated;

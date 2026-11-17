-- Enforce explicit acceptance of the company identity declaration.
-- Retire the legacy five-argument registration RPC so it cannot bypass consent.
revoke all on function public.submit_company_registration(text,text,text,text,text) from public,anon,authenticated;
revoke all on function private.submit_company_registration(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.submit_company_registration(text,text,text,text,text,text) from public,anon;
revoke all on function private.submit_company_registration(text,text,text,text,text,text) from public,anon;
grant execute on function public.submit_company_registration(text,text,text,text,text,text) to authenticated;
grant execute on function private.submit_company_registration(text,text,text,text,text,text) to authenticated;
